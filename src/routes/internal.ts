import { Hono } from "hono";
import { createDb, authHandoffs } from "@clipflow/db";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { UserService } from "../services/user.service";
import { zValidator } from "@hono/zod-validator";
import { UserSyncSchema } from "@clipflow/validations";
import { NotificationService } from "../services/notifications/notification.service";
import { linkUserRichMenu } from "../services/notifications/line/line.client";

export type InternalEnv = {
  DATABASE_URL: string;
  INTERNAL_API_SECRET?: string;
  INTERNAL_SECRET?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  NODE_ENV?: string;
  ENVIRONMENT?: string;
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
  const secret = c.env?.INTERNAL_API_SECRET || c.env?.INTERNAL_SECRET;
  const isDev = c.env?.NODE_ENV === "development" || c.env?.ENVIRONMENT === "development";

  if (!isDev || secret) {
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

// ─── PWA login handoff ─────────────────────────────────────────────────────
// An installed PWA cannot see cookies set in the system browser, where the
// LINE login completes. The PWA makes a random code; the browser (already
// signed in) registers it for the user here, and the PWA claims it once.

const HANDOFF_TTL_MINUTES = 10;
const HandoffCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);

async function hashHandoffCode(code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * POST /api/internal/auth-handoffs
 * Called by the Next.js server after LINE login finished in the browser.
 */
internalRouter.post(
  "/auth-handoffs",
  zValidator("json", z.object({ code: HandoffCodeSchema, userId: z.string().uuid() })),
  async (c: any) => {
    const db = c.get("db");
    const { code, userId } = c.req.valid("json");
    const codeHash = await hashHandoffCode(code);
    await db.insert(authHandoffs).values({ codeHash, userId }).onConflictDoNothing();
    // Opportunistic cleanup of expired codes.
    const cleanup = db.delete(authHandoffs)
      .where(lt(authHandoffs.createdAt, sql`now() - make_interval(mins => ${HANDOFF_TTL_MINUTES})`))
      .catch(() => {});
    if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(cleanup);
    return c.json({ status: "success", data: null }, 201);
  },
);

/**
 * POST /api/internal/auth-handoffs/claim
 * Called by the Next.js server for the PWA. Single use: the row is deleted.
 * Returns 404 while the browser has not finished logging in yet.
 */
internalRouter.post(
  "/auth-handoffs/claim",
  zValidator("json", z.object({ code: HandoffCodeSchema })),
  async (c: any) => {
    const db = c.get("db");
    const codeHash = await hashHandoffCode(c.req.valid("json").code);
    const [claimed] = await db.delete(authHandoffs)
      .where(and(
        eq(authHandoffs.codeHash, codeHash),
        gt(authHandoffs.createdAt, sql`now() - make_interval(mins => ${HANDOFF_TTL_MINUTES})`),
      ))
      .returning({ userId: authHandoffs.userId });
    if (!claimed) {
      return c.json({ status: "error", code: "NOT_READY", message: "Login not completed yet", data: null }, 404);
    }
    const user = await db.query.users.findFirst({
      where: (u: any, { eq: equal }: any) => equal(u.id, claimed.userId),
      columns: { id: true, role: true, displayName: true, pictureUrl: true, isActive: true },
    });
    if (!user || user.isActive === false) {
      return c.json({ status: "error", code: "INACTIVE", message: "User is inactive", data: null }, 403);
    }
    return c.json({ status: "success", data: user });
  },
);
