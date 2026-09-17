import { Hono } from "hono";
import { createDb } from "@clipflow/db";
import { UserService } from "../services/user.service";
import { zValidator } from "@hono/zod-validator";
import { UserSyncSchema } from "@clipflow/validations";
import { NotificationService } from "../services/notifications/notification.service";
import { linkUserRichMenu } from "../services/notifications/line/line.client";

export type InternalEnv = {
  DATABASE_URL: string;
  INTERNAL_SECRET?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  NODE_ENV?: string;
};

type InternalVars = { db: ReturnType<typeof createDb> };

export const internalRouter = new Hono<{
  Bindings: InternalEnv;
  Variables: InternalVars;
}>();

/**
 * Middleware: verify x-internal-secret header
 * - Production: rejects if secret is missing or wrong
 * - Development (NODE_ENV=development): bypasses if no INTERNAL_SECRET env is set
 */
internalRouter.use("*", async (c: any, next: any) => {
  const secret = c.env?.INTERNAL_SECRET;
  const isDev = !secret; // treat "no secret configured" as dev bypass

  if (!isDev) {
    const provided = c.req.header("x-internal-secret");
    if (!provided || provided !== secret) {
      return c.json(
        { status: "error", code: "UNAUTHORIZED", message: "Invalid internal secret", data: null },
        401,
      );
    }
  }

  await next();
});

/**
 * POST /api/internal/users/sync
 * Called by NextAuth signIn callback to sync LINE profile into DB.
 * Never accepts role from payload — role is always set by DB default or updated via /users/:id/role.
 */
internalRouter.post(
  "/users/sync",
  zValidator("json", UserSyncSchema),
  async (c: any) => {
    const db = c.get("db");
    const payload = c.req.valid("json");
    const service = new UserService(db);

    const { user, isNew, oldRole } = await service.syncLineUser(payload);

    // Trigger LINE Notification: Login Success (Editor only)
    if (!isNew && (user.role || oldRole) === "USER" && user.lineUserId) {
      try {
        const promise = NotificationService.dispatch(
          {
            type: "LOGIN_SUCCESS",
            payload: {
              toLineUserId: user.lineUserId,
              displayName: user.displayName || "Editor",
              channelAccessToken: c.env?.LINE_CHANNEL_ACCESS_TOKEN,
            },
          },
          db,
          c.env,
        );
        if (c.executionCtx?.waitUntil) {
          c.executionCtx.waitUntil(promise);
        } else {
          promise.catch(() => {});
        }
      } catch (err) {
        console.error("[LINE NOTIFY LOGIN ERROR]", err);
      }
    }

    // Link rich menu on login
    if (user.lineUserId) {
      try {
        const token = c.env?.LINE_CHANNEL_ACCESS_TOKEN;
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
  },
);
