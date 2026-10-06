import { Hono, type Context } from "hono";
import { NotificationService } from "../services/notifications/notification.service";
import { invalidateUserCache } from "../middleware/auth";
import { eq, ilike, and, or, sql } from "drizzle-orm";
import {
  createDb,
  users as usersSchema,
} from "@clipflow/db";
import { adminOnly } from "../middleware/role";
import { UserService } from "../services/user.service";
import { linkUserRichMenu } from "../services/notifications/line/line.client";
import { zValidator } from "@hono/zod-validator";
import { UserRoleUpdateSchema, UserStatusUpdateSchema, UserProfileUpdateSchema } from "@clipflow/validations";
import { handleApiError, paginated, parseListQuery, parseOptionalBoolean } from "../lib/api-contract";

export const users = new Hono<{
  Bindings: { DATABASE_URL: string; LINE_CHANNEL_ACCESS_TOKEN?: string };
  Variables: { db: ReturnType<typeof createDb> };
}>();

/**
 * GET /users
 * ADMIN only — list all users with pagination + filters
 */
users.get("/", adminOnly, async (c: Context) => {
  try {
    const db = c.get("db");
    const query = parseListQuery(c, {
      allowedSort: ["displayName", "lastActiveAt", "createdAt"] as const,
      defaultSort: "createdAt",
    });
    const roleFilter = c.req.query("role");
    const isActiveFilter = parseOptionalBoolean(c.req.query("isActive"));

    const conditions: any[] = [];
    if (query.q) {
      conditions.push(or(
        ilike(usersSchema.displayName, `%${query.q}%`),
        ilike(usersSchema.lineDisplayName, `%${query.q}%`),
      ));
    }
    if (roleFilter) {
      conditions.push(eq(usersSchema.role, roleFilter as any));
    }
    if (isActiveFilter !== undefined) {
      conditions.push(eq(usersSchema.isActive, isActiveFilter));
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [items, totalRows] = await Promise.all([
      db.query.users.findMany({
        where,
        orderBy: (u: any, { asc, desc }: any) => {
          const dir = query.sortOrder === "asc" ? asc : desc;
          const col =
            query.sortBy === "displayName" ? u.displayName
            : query.sortBy === "lastActiveAt" ? u.lastActiveAt
            : u.createdAt;
          return [dir(col), asc(u.id)];
        },
        limit: query.limit,
        offset: query.offset,
        columns: {
          id: true,
          displayName: true,
          role: true,
          isActive: true,
          pictureUrl: true,
          lineUserId: true,
          lineDisplayName: true,
          phone: true,
          email: true,
          profileCompletedAt: true,
          createdAt: true,
          lastActiveAt: true,
        },
      }),
      db.select({ count: sql<number>`count(*)::int` }).from(usersSchema).where(where),
    ]);

    return c.json({
      status: "success",
      message: "Users retrieved successfully",
      data: paginated(items, Number(totalRows[0].count), query.page, query.limit),
    });
  } catch (error) {
    return handleApiError(c, error);
  }
});

/**
 * GET /users/:id
 * Get a single user profile — self or ADMIN only
 */
users.get("/:id", async (c: Context) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const currentUser = c.get("user");

  if (!id)
    return c.json({ status: "error", message: "Missing user ID", data: null }, 400);

  // Object-level authorization: self or ADMIN only
  if (currentUser?.id !== id && currentUser?.role !== "ADMIN") {
    return c.json({ status: "error", message: "Not found", data: null }, 404);
  }

  const service = new UserService(db);
  const user = await service.getUser(id);

  if (!user) {
    return c.json({ status: "error", message: "User not found", data: null }, 404);
  }

  // Ensure logged-in user gets linked to the Menu-Editor Richmenu
  if (user.lineUserId) {
    try {
      const token = (c.env as any)?.LINE_CHANNEL_ACCESS_TOKEN;
      const promise = linkUserRichMenu(
        user.lineUserId,
        "richmenu-a719d2f87e69f0eaa3167da5004fcb8a",
        token,
      );
      if (c.executionCtx?.waitUntil) {
        c.executionCtx.waitUntil(promise);
      } else {
        promise.catch(() => {});
      }
    } catch (err) {
      console.error("[LINE LINK RICHMENU GET USER ERROR]", err);
    }
  }

  return c.json({
    status: "success",
    message: "User retrieved successfully",
    data: user,
  });
});

/**
 * PATCH /users/:id/profile
 * Update user profile (display name) — self or ADMIN
 */
users.patch("/:id/profile", zValidator("json", UserProfileUpdateSchema), async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const currentUser = c.get("user");

  if (!id) {
    return c.json({ status: "error", message: "Missing user ID", data: null }, 400);
  }

  // Security: users can only update their own profile, unless they are ADMIN
  if (currentUser?.id !== id && currentUser?.role !== "ADMIN") {
    return c.json({ status: "error", message: "Forbidden", data: null }, 403);
  }

  const body = c.req.valid("json");
  const service = new UserService(db);

  const updatedUser = await service.updateUserProfile(id, body);
  invalidateUserCache(id);

  if (!updatedUser) {
    return c.json({ status: "error", message: "User not found", data: null }, 404);
  }

  return c.json({
    status: "success",
    message: "Profile updated successfully",
    data: updatedUser,
  });
});

/**
 * PATCH /users/:id/role
 * ADMIN only — update user role
 */
users.patch("/:id/role", adminOnly, zValidator("json", UserRoleUpdateSchema), async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  if (!id) {
    return c.json({ status: "error", message: "Missing id", data: null }, 400);
  }

  const { role } = c.req.valid("json");
  const adminUser = c.get("user");
  const service = new UserService(db);

  const updated = await service.updateUserRole(id, role as any, adminUser?.id || null);
  invalidateUserCache(id);

  if (!updated) {
    return c.json({ status: "error", message: "User not found", data: null }, 404);
  }

  // Tell the user about any actual role change: in-app, LINE and web push.
  if (updated.previousRole !== role) {
    const promise = NotificationService.dispatch(
      {
        type: "ROLE_CHANGED",
        payload: {
          userId: updated.id,
          toLineUserId: updated.lineUserId || undefined,
          displayName: updated.displayName || "ผู้ใช้งาน",
          oldRole: updated.previousRole,
          newRole: role,
          changedBy: adminUser?.name,
          channelAccessToken: (c.env as any)?.LINE_CHANNEL_ACCESS_TOKEN,
        },
      },
      db,
      c.env as any,
    );
    if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(promise);
    else promise.catch(() => {});
  }

  return c.json({
    status: "success",
    message: "Role updated successfully",
    data: updated,
  });
});

/**
 * PATCH /users/:id/status
 * ADMIN only — toggle user active status
 */
users.patch("/:id/status", adminOnly, zValidator("json", UserStatusUpdateSchema), async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  if (!id) {
    return c.json({ status: "error", message: "Missing id", data: null }, 400);
  }

  const { isActive } = c.req.valid("json");
  const adminUser = c.get("user");
  const service = new UserService(db);

  const updated = await service.updateUserStatus(id, isActive, adminUser?.id || null);
  invalidateUserCache(id);

  if (!updated) {
    return c.json({ status: "error", message: "User not found", data: null }, 404);
  }

  return c.json({
    status: "success",
    message: "Status updated successfully",
    data: updated,
  });
});

/**
 * GET /users/:id/stats
 * Get user stats — self or ADMIN
 */
users.get("/:id/stats", async (c: Context) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const currentUser = c.get("user");

  if (!id) {
    return c.json({ status: "error", message: "Missing id", data: null }, 400);
  }

  // Self or ADMIN only
  if (currentUser?.id !== id && currentUser?.role !== "ADMIN") {
    return c.json({ status: "error", message: "Not found", data: null }, 404);
  }

  const service = new UserService(db);
  const stats = await service.getUserStats(id);

  return c.json({
    status: "success",
    message: "Stats retrieved successfully",
    data: stats,
  });
});
