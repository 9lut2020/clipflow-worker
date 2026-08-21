import type { Context, Next } from "hono";
import type { AuthUser } from "./auth";

type Role = AuthUser["role"];

/**
 * Role Guard Middleware
 * Usage: router.use("/:id", requireRole("ADMIN"))
 *        router.use("/:id", requireRole("ADMIN", "REVIEWER"))
 */
export const requireRole = (...roles: Role[]) => {
  return async (c: Context, next: Next) => {
    const user = c.get("user") as AuthUser | undefined;

    if (!user) {
      return c.json(
        { status: "error", message: "Authentication required", data: null },
        401,
      );
    }

    if (!roles.includes(user.role)) {
      return c.json(
        {
          status: "error",
          message: `Requires role: ${roles.join(" or ")}`,
          data: null,
        },
        403,
      );
    }

    return next();
  };
};

/** Shorthand guards */
export const adminOnly = requireRole("ADMIN");
export const reviewerOrAdmin = requireRole("REVIEWER", "ADMIN");
