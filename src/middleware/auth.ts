import type { Context, Next } from "hono";

export type AuthUser = {
  id: string;
  role: "USER" | "REVIEWER" | "ADMIN";
  name?: string;
};

interface CachedUser {
  user: any;
  expiresAt: number;
}
const userCache = new Map<string, CachedUser>();
const CACHE_TTL = 30 * 1000; // 30 seconds


declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

/**
 * Auth Middleware
 * Reads x-user-id and x-user-role headers sent by Next.js Server Components / Client Proxy
 * Database is the authoritative source of truth for user role & status.
 */
export const authMiddleware = async (c: Context, next: Next) => {
  // Internal routes are mounted before this middleware. Only the Worker health
  // check remains unauthenticated on this app instance.
  if (c.req.path === "/" || c.req.path === "/api") {
    return next();
  }

  const userId = c.req.header("x-user-id");

  if (userId) {
    const authStartedAt = performance.now();
    const db = c.get("db") as any;

    if (!db) {
      return c.json(
        {
          status: "error",
          message: "Database connection unavailable",
          data: null,
        },
        500,
      );
    }

    // Check cache first
    const now = Date.now();
    const cached = userCache.get(userId);
    let user;

    if (cached && cached.expiresAt > now) {
      user = cached.user;
    } else {
      // Safely query user without throwing UUID syntax errors
      user = await db.query.users
        .findFirst({
          where: (u: any, { eq }: any) => eq(u.id, userId),
          columns: {
            id: true,
            role: true,
            displayName: true,
            isActive: true,
            lineUserId: true,
          },
        })
        .catch(() => null);
        
      if (user) {
        // Cleanup cache occasionally to prevent memory leaks in the isolate
        if (userCache.size > 1000) userCache.clear();
        userCache.set(userId, { user, expiresAt: now + CACHE_TTL });
      }
    }
    c.header(
      "Server-Timing",
      `auth;dur=${Math.round(performance.now() - authStartedAt)}`,
    );

    if (!user || user.isActive === false) {
      return c.json(
        {
          status: "error",
          message: "Unauthorized: Unknown or inactive user",
          data: null,
        },
        401,
      );
    }

    let userRole = user.role as "USER" | "REVIEWER" | "ADMIN";

    // Allow frontend to override role for bypass/mock users ONLY in development
    const isDevelopment = process.env.NODE_ENV === "development";
    if (
      isDevelopment &&
      user.lineUserId &&
      (user.lineUserId.startsWith("bypass-") ||
        user.lineUserId.startsWith("mock-"))
    ) {
      const headerRole = c.req.header("x-user-role");
      if (
        headerRole === "ADMIN" ||
        headerRole === "REVIEWER" ||
        headerRole === "USER"
      ) {
        userRole = headerRole as any;
      }
    }

    // Set user context with authoritative database role
    c.set("user", {
      id: user.id,
      role: userRole,
      name: user.displayName,
    });

    return next();
  }

  return c.json(
    {
      status: "error",
      message: "Unauthorized: Missing user authentication headers",
    },
    401,
  );
};
