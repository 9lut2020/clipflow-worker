import { Hono } from "hono";
import { createDb } from "@clipflow/db";
import {
  notifyTestClipflowFlexCard,
  notifyLoginSuccess,
  notifyNeedsRevision,
  notifyClipApproved,
  notifySubmissionPending,
  notifyTaskAssigned,
  notifyTasksAssigned,
  notifyAdminGroupNewSubmission,
} from "../services/notifications/line/flex-templates";
import { adminOnly } from "../middleware/role";

export const notifications = new Hono<{
  Bindings: {
    DATABASE_URL: string;
    LINE_CHANNEL_ACCESS_TOKEN?: string;
    LINE_ADMIN_GROUP_ID?: string;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
  };
  Variables: { db: ReturnType<typeof createDb> };
}>();

import { eq, and, desc, count, sql, gte, lte } from "drizzle-orm";
import { notifications as notificationsSchema } from "@clipflow/db";
import { pushSubscriptions } from "@clipflow/db";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { handleApiError, paginated, parseListQuery, parseOptionalBoolean } from "../lib/api-contract";

const PushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

notifications.get("/push/public-key", async (c) => {
  if (!c.env.VAPID_PUBLIC_KEY) {
    return c.json({ status: "error", message: "Web Push is not configured", data: null }, 503);
  }
  return c.json({ status: "success", message: "VAPID public key retrieved", data: c.env.VAPID_PUBLIC_KEY });
});

notifications.post("/push/subscribe", zValidator("json", PushSubscriptionSchema), async (c) => {
  const user = c.get("user" as any);
  if (!user) return c.json({ status: "error", message: "Unauthorized", data: null }, 401);
  const subscription = c.req.valid("json");
  const db = c.get("db");

  await db.insert(pushSubscriptions).values({
    userId: user.id,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    expirationTime: subscription.expirationTime ?? null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: pushSubscriptions.endpoint,
    set: {
      userId: user.id,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      expirationTime: subscription.expirationTime ?? null,
      updatedAt: new Date(),
    },
  });

  return c.json({ status: "success", message: "Push subscription saved", data: null }, 201);
});

notifications.delete("/push/subscribe", async (c) => {
  const user = c.get("user" as any);
  if (!user) return c.json({ status: "error", message: "Unauthorized", data: null }, 401);
  const endpoint = c.req.query("endpoint");
  if (!endpoint) return c.json({ status: "error", message: "Endpoint is required", data: null }, 400);
  await c.get("db").delete(pushSubscriptions).where(and(
    eq(pushSubscriptions.userId, user.id),
    eq(pushSubscriptions.endpoint, endpoint),
  ));
  return c.json({ status: "success", message: "Push subscription removed", data: null });
});

/**
 * GET /notifications
 * Get paginated notifications for the current user, with optional filters
 */
notifications.get("/", async (c) => {
  try {
    const db = c.get("db");
    const user = c.get("user" as any);

    if (!user) {
      return c.json({ status: "error", message: "Unauthorized", data: null }, 401);
    }

    const query = parseListQuery(c, {
      allowedSort: ["createdAt"] as const,
      defaultSort: "createdAt",
    });
    const isRead = parseOptionalBoolean(c.req.query("isRead"));
    const typeFilter = c.req.query("type");
    const from = c.req.query("from");
    const to = c.req.query("to");

    const conditions: any[] = [eq(notificationsSchema.userId, user.id)];
    if (isRead !== undefined) conditions.push(eq(notificationsSchema.isRead, isRead));
    if (typeFilter) conditions.push(eq(notificationsSchema.type as any, typeFilter));
    if (from) conditions.push(gte(notificationsSchema.createdAt, new Date(`${from}T00:00:00Z`)));
    if (to) conditions.push(lte(notificationsSchema.createdAt, new Date(`${to}T23:59:59Z`)));

    const where = and(...conditions);

    const [items, totalRows] = await Promise.all([
      db.query.notifications.findMany({
        where,
        orderBy: [desc(notificationsSchema.createdAt)],
        limit: query.limit,
        offset: query.offset,
      }),
      db.select({ count: sql<number>`count(*)::int` }).from(notificationsSchema).where(where),
    ]);

    return c.json({
      status: "success",
      message: "Notifications retrieved",
      data: paginated(items, Number(totalRows[0].count), query.page, query.limit),
    });
  } catch (error) {
    return handleApiError(c, error);
  }
});

/**
 * GET /notifications/unread-count
 * Get count of unread notifications for the current user
 */
notifications.get("/unread-count", async (c) => {
  const db = c.get("db");
  const user = c.get("user" as any);

  if (!user) {
    return c.json({ status: "error", message: "Unauthorized", data: 0 }, 401);
  }

  const result = await db
    .select({ count: count() })
    .from(notificationsSchema)
    .where(and(
      eq(notificationsSchema.userId, user.id),
      eq(notificationsSchema.isRead, false)
    ));

  return c.json({
    status: "success",
    message: "Unread count retrieved",
    data: result[0].count,
  });
});

/**
 * PATCH /notifications/:id/read
 * Mark a notification as read
 */
notifications.patch("/:id/read", async (c) => {
  const db = c.get("db");
  const user = c.get("user" as any);
  const id = c.req.param("id");

  if (!user) {
    return c.json({ status: "error", message: "Unauthorized", data: null }, 401);
  }

  const [updated] = await db
    .update(notificationsSchema)
    .set({ isRead: true })
    .where(and(
      eq(notificationsSchema.id, id),
      eq(notificationsSchema.userId, user.id)
    ))
    .returning();

  if (!updated) {
    return c.json({ status: "error", message: "Notification not found", data: null }, 404);
  }

  return c.json({
    status: "success",
    message: "Notification marked as read",
    data: updated,
  });
});

/**
 * PATCH /notifications/read-all
 * Mark all notifications as read for current user
 */
notifications.patch("/read-all", async (c) => {
  const db = c.get("db");
  const user = c.get("user" as any);

  if (!user) {
    return c.json({ status: "error", message: "Unauthorized", data: null }, 401);
  }

  await db
    .update(notificationsSchema)
    .set({ isRead: true })
    .where(and(
      eq(notificationsSchema.userId, user.id),
      eq(notificationsSchema.isRead, false)
    ));

  return c.json({
    status: "success",
    message: "All notifications marked as read",
    data: null,
  });
});

/**
 * POST /notifications/test-line
 * Send test LINE notification (Flex Card) to lineUserId — ADMIN only
 */
notifications.post("/test-line", adminOnly, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const user = c.get("user" as any);

  // No hardcoded fallback — require explicit lineUserId or authenticated user's lineUserId
  const lineUserId = body.lineUserId || (user as any)?.lineUserId;
  if (!lineUserId) {
    return c.json(
      { status: "error", message: "lineUserId is required", data: null },
      400,
    );
  }

  const type = body.type || "TEST";

  let result = { success: false, message: "" };
  const token = c.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (type === "TEST") {
    result = await notifyTestClipflowFlexCard({
      toLineUserId: lineUserId,
      channelAccessToken: token,
    });
  } else if (type === "LOGIN") {
    result = await notifyLoginSuccess({
      toLineUserId: lineUserId,
      displayName: body.displayName || user?.displayName || "Lut",
      channelAccessToken: token,
    });
  } else if (type === "MULTI_ASSIGNED") {
    result = await notifyTasksAssigned({
      toLineUserId: lineUserId,
      assignerName: body.assignerName || "บังอาคีรัฐ (Admin)",
      tasks: body.tasks || [
        {
          clipId: "clip-1",
          clipName: "คลิปเปิดตัวสินค้าใหม่ EP.1 (TikTok Short)",
          projectName: "TikTok Campaign 2026",
        },
        {
          clipId: "clip-2",
          clipName: "คลิปรีวิวจากผู้ใช้งานจริง EP.2 (FB Reel)",
          projectName: "FB Reels Campaign",
        },
        {
          clipId: "clip-3",
          clipName: "คลิปเบื้องหลังการทำงานทีมโปรดักชัน EP.3",
          projectName: "Behind The Scenes",
        },
      ],
      channelAccessToken: token,
    });
  } else if (type === "ASSIGNED") {
    result = await notifyTaskAssigned({
      toLineUserId: lineUserId,
      clipName: body.clipName || "คลิปโปรโมทสินค้าคอลเลกชันใหม่ EP.1",
      projectName: body.projectName || "TikTok Marketing Campaign",
      assignerName: body.assignerName || "บังอาคีรัฐ (Admin)",
      clipId: body.clipId || "demo-clip-id",
      channelAccessToken: token,
    });
  } else if (type === "APPROVED") {
    result = await notifyClipApproved({
      toLineUserId: lineUserId,
      clipName: body.clipName || "คลิปวิดีโอเปิดตัวสินค้า EP.1",
      projectName: body.projectName || "TikTok Marketing Campaign",
      reviewerName: body.reviewerName || "บังอาคีรัฐ (Senior Reviewer)",
      comment:
        body.comment ||
        "ผ่านการอนุมัติเรียบร้อย ตัดต่อได้ยอดเยี่ยมมากครับ! 👏",
      clipId: body.clipId || "demo-clip-id",
      channelAccessToken: token,
    });
  } else if (type === "SUBMIT") {
    result = await notifySubmissionPending({
      toLineUserId: lineUserId,
      clipName: body.clipName || "คลิปวิดีโอเปิดตัวสินค้า EP.1",
      projectName: body.projectName || "TikTok Marketing Campaign",
      driveUrl: body.driveUrl || "https://drive.google.com/file/d/sample/view",
      submitNote:
        body.submitNote || "ปรับแก้สีและเสียงตามที่ผู้ตรวจระบุเรียบร้อยครับ",
      clipId: body.clipId || "demo-clip-id",
      channelAccessToken: token,
    });
  } else if (type === "GROUP_SUBMIT") {
    result = await notifyAdminGroupNewSubmission({
      clipName: body.clipName || "คลิปวิดีโอเปิดตัวสินค้า EP.1 (ส่งกลุ่มผู้ตรวจ)",
      projectName: body.projectName || "TikTok Marketing Campaign",
      editorName: body.editorName || "Editor (คนทำคลิป)",
      submitNote: body.submitNote || "ส่งตรวจคลิปงานแก้ไขเรียบร้อยในแชทกลุ่มผู้ตรวจ",
      clipId: body.clipId || "demo-clip-id",
      channelAccessToken: token,
      adminGroupId: c.env.LINE_ADMIN_GROUP_ID,
    });
  } else {
    // Default: NEEDS_REVISION
    result = await notifyNeedsRevision({
      toLineUserId: lineUserId,
      clipName: body.clipName || "คลิปวิดีโอเปิดตัวสินค้า EP.1 (รอบที่ 2)",
      projectName: body.projectName || "TikTok Marketing Campaign",
      reviewerName: body.reviewerName || "บังอาคีรัฐ (Senior Reviewer)",
      comment:
        body.comment ||
        "โปรดปรับลดความดังเพลงประกอบลง 20% ในนาทีที่ 01:15 และเพิ่มซับไตเติลภาษาไทยให้ชัดเจนขึ้นครับ",
      clipId: body.clipId || "demo-clip-id",
      channelAccessToken: token,
    });
  }

  return c.json({
    status: result.success ? "success" : "error",
    message: result.message,
    data: { recipientLineUserId: lineUserId, type },
  });
});
