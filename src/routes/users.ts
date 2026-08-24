import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import {
  createDb,
  users as usersSchema,
  clips as clipsSchema,
} from "@clipflow/db";
import { adminOnly } from "../middleware/role";
import { NotificationService } from "../services/notifications/notification.service";
import { notifyReviewerRoleGranted } from "../services/notifications/line/flex-templates";
import { UserService } from "../services/user.service";
import { linkUserRichMenu } from "../services/notifications/line/line.client";
import { zValidator } from "@hono/zod-validator";
import { UserSyncSchema, UserRoleUpdateSchema, UserStatusUpdateSchema, UserProfileUpdateSchema } from "@clipflow/validations";

export const users = new Hono<{
  Bindings: { DATABASE_URL: string };
  Variables: { db: ReturnType<typeof createDb> };
}>();

/**
 * GET /users
 * ADMIN only — list all users
 */
users.get("/", adminOnly, async (c: Context) => {
  const db = c.get("db");
  const service = new UserService(db);
  const allUsers = await service.listUsers();
  return c.json({
    status: "success",
    message: "Users retrieved successfully",
    data: allUsers,
  });
});

/**
 * GET /users/:id
 * Get a single user profile
 */
users.get("/:id", async (c: Context) => {
  const db = c.get("db");
  const id = c.req.param("id");
  if (!id)
    return c.json(
      { status: "error", message: "Missing user ID", data: null },
      400,
    );

  const service = new UserService(db);
  const user = await service.getUser(id);

  if (!user) {
    return c.json(
      { status: "error", message: "User not found", data: null },
      404,
    );
  }

  return c.json({
    status: "success",
    message: "User retrieved successfully",
    data: user,
  });
});

/**
 * PATCH /users/:id/profile
 * Update user profile (display name)
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

  const { displayName } = c.req.valid("json");
  const service = new UserService(db);

  const updatedUser = await service.updateUserProfile(id, displayName);

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
 * POST /users/sync
 * Sync LINE Login user with Neon PostgreSQL database
 */
users.post("/sync", zValidator("json", UserSyncSchema), async (c) => {
  const db = c.get("db");
  const payload = c.req.valid("json");
  const service = new UserService(db);

  const { user, isNew, oldRole } = await service.syncLineUser(payload);

  // Trigger LINE Notification 1: Login Success (Editor)
  if (!isNew && (user.role || oldRole) === "USER" && user.lineUserId) {
    try {
      const promise = NotificationService.dispatch({
        type: "LOGIN_SUCCESS",
        payload: {
          toLineUserId: user.lineUserId,
          displayName: user.displayName || "Editor",
          channelAccessToken: (c.env as any)?.LINE_CHANNEL_ACCESS_TOKEN,
        }
      }, db);
      if (c.executionCtx?.waitUntil) {
        c.executionCtx.waitUntil(promise);
      } else {
        promise.catch(() => {});
      }
    } catch (err) {
      console.error("[LINE NOTIFY LOGIN ERROR]", err);
    }
  }

  // Link Menu-Editor Richmenu to User on successful sync/login
  if (user.lineUserId) {
    try {
      const token = (c.env as any)?.LINE_CHANNEL_ACCESS_TOKEN;
      const promise = linkUserRichMenu(
        user.lineUserId,
        "richmenu-eecdcd78d9f5b0a1a6497d0ca641d607",
        token
      );
      if (c.executionCtx?.waitUntil) {
        c.executionCtx.waitUntil(promise);
      } else {
        promise.catch(() => {});
      }
    } catch (err) {
      console.error("[LINE LINK RICHMENU ERROR]", err);
    }
  }

  return c.json(
    {
      status: "success",
      message: isNew ? "User created successfully" : "User synced successfully",
      data: user,
    },
    isNew ? 201 : 200,
  );
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

  if (!updated) {
    return c.json(
      { status: "error", message: "User not found", data: null },
      404,
    );
  }

  // Trigger LINE Notification: Send Group Invite link to newly appointed Reviewer
  if (role === "REVIEWER" && updated.lineUserId) {
    try {
      await notifyReviewerRoleGranted({
        toLineUserId: updated.lineUserId,
        displayName: updated.displayName || "ผู้ตรวจงาน",
        channelAccessToken: (c.env as any)?.LINE_CHANNEL_ACCESS_TOKEN,
      });
    } catch (err) {
      console.error("[LINE NOTIFY REVIEWER ROLE ERROR]", err);
    }
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

  if (!updated) {
    return c.json(
      { status: "error", message: "User not found", data: null },
      404,
    );
  }

  return c.json({
    status: "success",
    message: "Status updated successfully",
    data: updated,
  });
});

/**
 * GET /users/:id/stats
 * Get user stats (total clips, approved, pending, revision count)
 */
users.get("/:id/stats", async (c: Context) => {
  const db = c.get("db");
  const id = c.req.param("id");
  if (!id) {
    return c.json({ status: "error", message: "Missing id", data: null }, 400);
  }
  const service = new UserService(db);

  const stats = await service.getUserStats(id);

  return c.json({
    status: "success",
    message: "Stats retrieved successfully",
    data: stats,
  });
});
