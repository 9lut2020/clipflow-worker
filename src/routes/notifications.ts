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
} from "../services/notifications/line/flex-templates";

export const notifications = new Hono<{
  Bindings: { DATABASE_URL: string; LINE_CHANNEL_ACCESS_TOKEN?: string };
  Variables: { db: ReturnType<typeof createDb> };
}>();

import { eq, and, desc, count } from "drizzle-orm";
import { notifications as notificationsSchema } from "@clipflow/db";

/**
 * GET /notifications
 * Get all notifications for the current user
 */
notifications.get("/", async (c) => {
  const db = c.get("db");
  const user = c.get("user" as any);

  if (!user) {
    return c.json({ status: "error", message: "Unauthorized", data: null }, 401);
  }

  const items = await db.query.notifications.findMany({
    where: eq(notificationsSchema.userId, user.id),
    orderBy: [desc(notificationsSchema.createdAt)],
    limit: 50,
  });

  return c.json({
    status: "success",
    message: "Notifications retrieved",
    data: items,
  });
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
 * Send test LINE notification (Flex Card) to lineUserId
 */
notifications.post("/test-line", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const user = c.get("user" as any);

  const lineUserId =
    body.lineUserId || user?.lineUserId || "U78d6e86d647fc4571b91793ee8c4f4fc";
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
