import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { users as usersSchema } from "@clipflow/db";

export type AuthUser = {
  id: string;
  role: "USER" | "REVIEWER" | "ADMIN";
  name?: string;
};

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
  // Bypass for system sync route, health checks & test-line notification route
  if (
    c.req.path === "/" ||
    c.req.path === "/api" ||
    c.req.path.endsWith("/users/sync") ||
    c.req.path.endsWith("/notifications/test-line")
  ) {
    return next();
  }

  const userId = c.req.header("x-user-id");

  if (userId) {
    const db = c.get("db") as any;

    if (!db) {
      return c.json(
        { status: "error", message: "Database connection unavailable", data: null },
        500,
      );
    }

    // Safely query user without throwing UUID syntax errors
    const user = await db.query.users
      .findFirst({
        where: (u: any, { eq }: any) => eq(u.id, userId),
        columns: {
          id: true,
          role: true,
          displayName: true,
          isActive: true,
        },
      })
      .catch(() => null);

    if (!user || user.isActive === false) {
      return c.json(
        { status: "error", message: "Unauthorized: Unknown or inactive user", data: null },
        401,
      );
    }

    // Set user context with authoritative database role
    c.set("user", {
      id: user.id,
      role: user.role as "USER" | "REVIEWER" | "ADMIN",
      name: user.displayName,
    });

    return next();
  }

  return c.json(
    { status: "error", message: "Unauthorized: Missing user authentication headers" },
    401,
  );
};
