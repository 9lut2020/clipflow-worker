import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { createDb } from "@clipflow/db";
import { authMiddleware } from "./middleware/auth";
import { projects } from "./routes/projects";
import { episodes } from "./routes/episodes";
import { clips } from "./routes/clips";
import { users } from "./routes/users";
import { revisions } from "./routes/revisions";
import { notifications } from "./routes/notifications";
import { activityLogsRouter } from "./routes/activity-logs";
import { analyticsRouter } from "./routes/analytics";
import { adminRouter } from "./routes/admin";
import { aggregateDailyMetrics } from "./cron/analytics-aggregator";

export type Env = {
  DATABASE_URL: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
  LINE_LIFF_ID: string;
  GOOGLE_SERVICE_ACCOUNT_KEY: string;
  JWT_SECRET: string;
  NOTIFICATION_QUEUE: Queue;
};

type Variables = {
  db: ReturnType<typeof createDb>;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Global Middleware ─────────────────────────────────────────────────────
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (
        !origin ||
        origin.includes("localhost") ||
        origin.includes("127.0.0.1") ||
        origin.endsWith("vercel.app") ||
        origin.endsWith("trycloudflare.com")
      ) {
        return origin || "*";
      }
      return "https://clipflow-tmyda.vercel.app";
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "x-user-id",
      "x-user-role",
      "x-requested-with",
    ],
    exposeHeaders: ["Content-Length"],
    maxAge: 86400,
    credentials: true,
  })
);
app.use("*", logger());

// Inject DB instance
app.use("*", async (c: any, next: any) => {
  if (!c.get("db")) {
    const db = createDb(c.env.DATABASE_URL);
    c.set("db", db);
  }
  await next();
});

// ─── Health Check ──────────────────────────────────────────────────────────
app.get("/", (c: any) =>
  c.json({ status: "ok", service: "clipflow-worker", version: "1.0.0" }),
);

// ─── LINE Webhook (Public route to capture Group ID on join/message) ───────
import {
  buildDailySummaryFlexCard,
  buildMyTasksFlexCard,
  buildEditorPrivateMenuFlexCard,
} from "./services/notifications/line/flex-templates";

app.post("/webhook/line", async (c: any) => {
  try {
    const db = c.get("db");
    const body = await c.req.json();
    const token = (c.env as any)?.LINE_CHANNEL_ACCESS_TOKEN;

    const events = body?.events || [];
    for (const event of events) {
      const source = event?.source;
      const replyToken = event?.replyToken;
      const userMsg = event?.message?.text?.trim() || "";

      if (replyToken) {
        if (userMsg === "สรุปงานวันนี้") {
          const allClips = await db.query.clips.findMany();
          const pending = allClips.filter(
            (c: any) => c.status === "PENDING_REVIEW" || c.status === "IN_REVIEW",
          ).length;
          const revision = allClips.filter(
            (c: any) => c.status === "NEEDS_REVISION",
          ).length;
          const approved = allClips.filter(
            (c: any) => c.status === "APPROVED",
          ).length;

          const flexContents = buildDailySummaryFlexCard({
            pending,
            revision,
            approved,
            total: allClips.length,
          });

          await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              replyToken,
              messages: [
                {
                  type: "flex",
                  altText: "📊 สรุปภาพรวมงานวันนี้ - ClipFlow",
                  contents: flexContents,
                },
              ],
            }),
          }).catch((err) => console.error("[LINE REPLY SUMMARY ERROR]", err));
        } else if (userMsg === "งานของฉัน" && source?.userId) {
          const user = await db.query.users.findFirst({
            where: (u: any, { eq }: any) => eq(u.lineUserId, source.userId),
          });

          const myClips = user
            ? await db.query.clips.findMany({
                where: (clips: any, { eq }: any) => eq(clips.ownerId, user.id),
              })
            : [];

          const flexContents = buildMyTasksFlexCard({
            displayName: user?.displayName || "คุณ",
            clips: myClips,
          });

          await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              replyToken,
              messages: [
                {
                  type: "flex",
                  altText: `📋 งานของฉัน - ClipFlow`,
                  contents: flexContents,
                },
              ],
            }),
          }).catch((err) => console.error("[LINE REPLY TASKS ERROR]", err));
        } else if (source?.type === "user" && source?.userId) {
          // 1-on-1 Private chat default response
          const user = await db.query.users.findFirst({
            where: (u: any, { eq }: any) => eq(u.lineUserId, source.userId),
          });

          const flexContents = buildEditorPrivateMenuFlexCard({
            displayName: user?.displayName,
          });

          await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              replyToken,
              messages: [
                {
                  type: "flex",
                  altText: "🎬 CLIPFLOW Editor Assistant",
                  contents: flexContents,
                },
              ],
            }),
          }).catch((err) => console.error("[LINE REPLY PRIVATE MENU ERROR]", err));
        }
      }
    }
    return c.text("OK", 200);
  } catch (err: any) {
    console.error("[LINE WEBHOOK ERROR]", err);
    return c.text("OK", 200);
  }
});

// ─── API Routes ────────────────────────────────────────────────────────────
const api = new Hono<{ Bindings: Env; Variables: Variables }>();

// Auth middleware applies to all /api/* routes
api.use("*", authMiddleware);

api.route("/projects", projects);
api.route("/episodes", episodes);
api.route("/clips", clips);
api.route("/users", users);
api.route("/revisions", revisions);
api.route("/notifications", notifications);
api.route("/activity-logs", activityLogsRouter);
api.route("/analytics", analyticsRouter);
api.route("/admin", adminRouter);

app.route("/api", api);

// ─── 404 ───────────────────────────────────────────────────────────────────
app.notFound((c: any) =>
  c.json(
    {
      success: false,
      error: { code: "NOT_FOUND", message: "Route not found" },
    },
    404,
  ),
);

// ─── Error Handler ─────────────────────────────────────────────────────────
app.onError((err: any, c: any) => {
  console.error("[ERROR]", err.message);
  return c.json(
    { success: false, error: { code: "INTERNAL_ERROR", message: err.message } },
    500,
  );
});

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    if (event.cron === "0 0 * * *") {
      await aggregateDailyMetrics(env);
    }
  },

  async queue(_batch: MessageBatch<unknown>, _env: Env) {
    // Future: notification queue
  },
};
