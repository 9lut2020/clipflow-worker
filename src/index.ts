import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { linkUserRichMenu } from "./services/notifications/line/line.client";

import { createDb } from "@clipflow/db";
import { authMiddleware } from "./middleware/auth";
import { projects } from "./routes/projects";
import { episodes } from "./routes/episodes";
import { clips } from "./routes/clips";
import { users } from "./routes/users";
import { revisions } from "./routes/revisions";
import { notifications } from "./routes/notifications";
import { analyticsRouter } from "./routes/analytics";
import { adminRouter } from "./routes/admin";
import { videoSizesRouter } from "./routes/video-sizes";
import { publishSchedulesRouter } from "./routes/publish-schedules";
import { internalRouter } from "./routes/internal";
import { aggregateDailyMetrics } from "./cron/analytics-aggregator";

export type Env = {
  DATABASE_URL: string;
  HYPERDRIVE?: { connectionString: string };
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
  LINE_LIFF_ID: string;
  GOOGLE_SERVICE_ACCOUNT_KEY: string;
  JWT_SECRET: string;
  NOTIFICATION_QUEUE: Queue;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  INTERNAL_API_SECRET?: string;
  ENVIRONMENT?: string;
  CORS_ORIGINS?: string;
};

type Variables = {
  db: ReturnType<typeof createDb>;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Global Middleware ─────────────────────────────────────────────────────
app.use("*", async (c: any, next: any) => {
  const configured = String(c.env?.CORS_ORIGINS || "https://clipflow-tmyda.vercel.app").split(",").map((value) => value.trim()).filter(Boolean);
  const middleware = cors({
    origin: (origin) => {
      if (!origin) return configured[0] || "";
      if (configured.includes(origin)) return origin;
      if (c.env?.ENVIRONMENT === "development" && (origin.includes("localhost") || origin.includes("127.0.0.1") || origin.endsWith("trycloudflare.com"))) return origin;
      return "";
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "x-user-id",
      "x-user-role",
      "x-request-id",
      "x-requested-with",
    ],
    exposeHeaders: ["Content-Length", "Server-Timing", "x-request-id"],
    maxAge: 86400,
    credentials: true,
  });
  return middleware(c, next);
});
app.use("*", logger());
app.use("*", secureHeaders());
app.use("*", async (c: any, next: any) => {
  const requestId = c.req.header("x-request-id") || crypto.randomUUID();
  c.header("x-request-id", requestId);
  await next();
});

// Surface backend time in the browser Network panel without logging every
// request or exposing database details. It makes slow endpoints actionable.
app.use("*", async (c: any, next: any) => {
  const startedAt = performance.now();
  await next();
  const existing = c.res.headers.get("Server-Timing");
  const appTiming = `app;dur=${Math.round(performance.now() - startedAt)}`;
  c.header("Server-Timing", existing ? `${existing}, ${appTiming}` : appTiming);
});

// API responses are user- and role-scoped. Never let a CDN or browser reuse a
// pre-mutation response, otherwise a successful write appears to revert after
// navigation or refresh.
app.use("/api/*", async (c: any, next: any) => {
  await next();
  c.header("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  const vary = c.res.headers.get("Vary");
  c.header("Vary", vary ? `${vary}, x-user-id` : "x-user-id");
});

// Only persistent routes receive a DB instance. Health and other stateless
// requests must not initialise database infrastructure.
const injectDb = async (c: any, next: any) => {
  if (!c.get("db")) c.set("db", createDb(c.env.DATABASE_URL));
  await next();
};

app.use("/webhook/line", injectDb);
app.use("/api/*", async (c: any, next: any) => {
  if (c.req.path === "/api/health") return next();
  return injectDb(c, next);
});

// ─── Health Check ──────────────────────────────────────────────────────────
app.get("/", (c: any) =>
  c.json({ status: "ok", service: "clipflow-worker", version: "1.0.0" }),
);

// Liveness probe. Deliberately avoids database, authentication, and external I/O.
app.get("/api/health", (c: any) =>
  c.json({ status: "ok", service: "clipflow-api", timestamp: new Date().toISOString() }),
);

// ─── LINE Webhook (Public route to capture Group ID on join/message) ───────
import {
  buildDailySummaryFlexCard,
  buildMyTasksFlexCard,
  buildEditorPrivateMenuFlexCard,
  buildLoginRequiredFlexCard,
  buildPendingReviewFlexCard,
} from "./services/notifications/line/flex-templates";

const showTypingIndicator = async (chatId: string, token: string, seconds = 20) => {
  if (!chatId) return;
  try {
    await fetch("https://api.line.me/v2/bot/chat/loading/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ chatId, loadingSeconds: seconds }),
    });
  } catch (err) {
    console.error("[TYPING INDICATOR ERROR]", err);
  }
};

app.post("/webhook/line", async (c: any) => {
  try {
    const db = c.get("db");
    const rawBody = await c.req.text();
    if (new TextEncoder().encode(rawBody).byteLength > 1024 * 1024) return c.text("Payload Too Large", 413);
    const signature = c.req.header("x-line-signature") || "";
    const channelSecret = c.env?.LINE_CHANNEL_SECRET || "";
    if (!signature || !channelSecret) return c.text("Unauthorized", 401);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(channelSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const expected = btoa(String.fromCharCode(...new Uint8Array(signed)));
    if (signature.length !== expected.length || !signature.split("").every((char: string, index: number) => char.charCodeAt(0) === expected.charCodeAt(index))) return c.text("Unauthorized", 401);
    const body = JSON.parse(rawBody);
    const token = (c.env as any)?.LINE_CHANNEL_ACCESS_TOKEN;

    const events = body?.events || [];
    for (const event of events) {
      const source = event?.source;
      const replyToken = event?.replyToken;
      const userMsg = event?.message?.text?.trim() || "";
      
      const chatId = source?.userId || source?.groupId || source?.roomId;

      if (!replyToken) continue;

      if (source?.type === "user") {
        // --- PRIVATE CHAT LOGIC ---
        await showTypingIndicator(chatId, token);
        const user = await db.query.users.findFirst({
          where: (u: any, { eq }: any) => eq(u.lineUserId, source.userId),
        });

        // 1. Unregistered User check
        if (!user) {
          // Link register richmenu dynamically
          if (source?.userId) {
            linkUserRichMenu(source.userId, "richmenu-98bca41053454b957ef38c486f18ab17", token).catch((err) => {
              console.error("[LINE LINK REGISTER RICHMENU ERROR]", err);
            });
          }

          const flexContents = buildLoginRequiredFlexCard();
          await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              replyToken,
              messages: [{ type: "flex", altText: "🔒 กรุณาเข้าสู่ระบบก่อนใช้งาน", contents: flexContents }],
            }),
          }).catch((err) => console.error("[LINE REPLY LOGIN REQUIRED ERROR]", err));
          continue;
        }

        // 2. Registered User Commands
        if (user.lineUserId) {
          linkUserRichMenu(user.lineUserId, "richmenu-a719d2f87e69f0eaa3167da5004fcb8a", token).catch((err) => {
            console.error("[LINE LINK EDITOR RICHMENU WEBHOOK ERROR]", err);
          });
        }
        if (userMsg === "งานของฉัน") {
          const myClips = await db.query.clips.findMany({
            where: (clips: any, { eq, and, ne }: any) => 
              and(eq(clips.ownerId, user.id), ne(clips.status, "APPROVED")),
          });

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
              messages: [{ type: "flex", altText: "📋 งานของฉัน - ClipFlow", contents: flexContents }],
            }),
          }).catch((err) => console.error("[LINE REPLY MY TASKS ERROR]", err));
        } else {
          // Default Menu for Private Chat
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
              messages: [{ type: "flex", altText: "🎬 CLIPFLOW Editor Assistant", contents: flexContents }],
            }),
          }).catch((err) => console.error("[LINE REPLY PRIVATE MENU ERROR]", err));
        }

      } else if (source?.type === "group" || source?.type === "room") {
        // --- GROUP CHAT LOGIC ---
        if (userMsg === "สรุปงานวันนี้") {
          await showTypingIndicator(chatId, token);
          const allClips = await db.query.clips.findMany();
          const pending = allClips.filter((c: any) => c.status === "PENDING_REVIEW" || c.status === "IN_REVIEW").length;
          const revision = allClips.filter((c: any) => c.status === "NEEDS_REVISION").length;
          const approved = allClips.filter((c: any) => c.status === "APPROVED").length;

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
              messages: [{ type: "flex", altText: "📊 สรุปภาพรวมงานวันนี้ - ClipFlow", contents: flexContents }],
            }),
          }).catch((err) => console.error("[LINE REPLY SUMMARY ERROR]", err));

        } else if (userMsg === "งานที่ต้องตรวจ") {
          await showTypingIndicator(chatId, token);
          const allClips = await db.query.clips.findMany();
          const pending = allClips.filter((c: any) => c.status === "PENDING_REVIEW" || c.status === "IN_REVIEW").length;
          const revision = allClips.filter((c: any) => c.status === "NEEDS_REVISION").length;

          const flexContents = buildPendingReviewFlexCard({ pending, revision });

          await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              replyToken,
              messages: [{ type: "flex", altText: "🔍 งานที่รอการตรวจสอบ - ClipFlow", contents: flexContents }],
            }),
          }).catch((err) => console.error("[LINE REPLY PENDING REVIEW ERROR]", err));
        }
        // Group chat silently ignores all other messages
      }
    }
    return c.text("OK", 200);
  } catch (err: any) {
    console.error("[LINE WEBHOOK ERROR]", err);
    return c.text("OK", 200);
  }
});

// ─── Internal API (x-internal-secret guard, no user auth) ──────────────────
app.route("/api/internal", internalRouter);

// ─── Authenticated API Routes ──────────────────────────────────────────────
const api = new Hono<{ Bindings: Env; Variables: Variables }>();

// Auth middleware applies to all /api/* routes
api.use("*", authMiddleware);

api.route("/projects", projects);
api.route("/episodes", episodes);
api.route("/clips", clips);
api.route("/users", users);
api.route("/revisions", revisions);
api.route("/notifications", notifications);
api.route("/analytics", analyticsRouter);
api.route("/admin", adminRouter);
api.route("/video-sizes", videoSizesRouter);
api.route("/publish-schedules", publishSchedulesRouter);

app.route("/api", api);

// ─── 404 ───────────────────────────────────────────────────────────────────
app.notFound((c: any) =>
  c.json(
    { success: false, error: { code: "NOT_FOUND", message: "Route not found" } },
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
