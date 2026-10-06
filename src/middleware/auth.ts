import type { Context, Next } from "hono";

export type AuthUser = {
  id: string;
  role: "USER" | "REVIEWER" | "ADMIN";
  name?: string;
};

interface CachedUser {
  user: Promise<any>;
  expiresAt: number;
}
const userCache = new Map<string, CachedUser>();
const CACHE_TTL = 30 * 1000; // 30 seconds

/** Drop a cached user after a role/status change so this isolate sees it immediately. */
export const invalidateUserCache = (userId: string) => userCache.delete(userId);


function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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

  // x-user-id is only trustworthy when the request came from our Next.js
  // server. When a shared secret is configured, every API call must carry it;
  // otherwise anyone who knows the public Worker URL could impersonate a user.
  const secret = (c.env as any)?.INTERNAL_API_SECRET || (c.env as any)?.INTERNAL_SECRET;
  if (secret && !timingSafeEqual(c.req.header("x-internal-secret") || "", secret)) {
    return c.json(
      { status: "error", message: "Unauthorized: Invalid request origin", data: null },
      401,
    );
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

    // Check cache first. In-flight lookups are shared, so parallel requests
    // from one page load hit the database once instead of once each.
    const now = Date.now();
    const cached = userCache.get(userId);
    let user;

    if (cached && cached.expiresAt > now) {
      user = await cached.user;
    } else {
      const lookup = db.query.users
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
        // Invalid UUIDs throw; treat them as unknown users.
        .catch(() => null);
      // Cleanup cache occasionally to prevent memory leaks in the isolate
      if (userCache.size > 1000) userCache.clear();
      userCache.set(userId, { user: lookup, expiresAt: now + CACHE_TTL });
      user = await lookup;
      if (!user) userCache.delete(userId);
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
    const isDevelopment = (c.env as any)?.ENVIRONMENT === "development";
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
