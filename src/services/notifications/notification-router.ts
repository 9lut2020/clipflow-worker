import { LinePersonalService } from "./line/line-personal.service";
import { LineGroupService } from "./line/line-group.service";
import { createDb, notifications } from "@clipflow/db";
import { WebPushService } from "./web-push.service";

export type NotificationEvent =
  | { type: "NEEDS_REVISION"; payload: any }
  | { type: "APPROVED"; payload: any }
  | { type: "TASK_ASSIGNED"; payload: any }
  | { type: "MULTI_TASK_ASSIGNED"; payload: any }
  | { type: "LOGIN_SUCCESS"; payload: any }
  | { type: "PENDING_REVIEW"; payload: any };

export const NotificationRouter = {
  async route(event: NotificationEvent, db: ReturnType<typeof createDb>, env: any = {}) {
    const push = (userId: string | undefined, title: string, body: string, url?: string) =>
      userId ? WebPushService.sendToUsers({ db, userIds: [userId], message: { title, body, url }, env }) : Promise.resolve();

    switch (event.type) {
      case "NEEDS_REVISION":
        // 1. Insert In-App Notification
        if (event.payload.ownerId) {
          await db.insert(notifications).values({
            userId: event.payload.ownerId,
            type: event.type,
            title: `คลิปถูกสั่งแก้ไข`,
            message: `คลิป "${event.payload.clipName}" ถูกสั่งแก้ไขโดย ${event.payload.reviewerName}`,
            linkUrl: `/projects/${event.payload.projectId}/clips/${event.payload.clipId}`
          }).catch(err => console.error("[IN-APP NOTIFY ERROR]", err));
        }
        // 2. Dispatch LINE
        await LinePersonalService.sendNeedsRevision(event.payload).catch((err) =>
          console.error("[NOTIFICATION ROUTER] Needs Revision Failed", err)
        );
        await push(event.payload.ownerId, "คลิปถูกสั่งแก้ไข", `คลิป \"${event.payload.clipName}\" ถูกสั่งแก้ไข`, `/projects/${event.payload.projectId}/clips/${event.payload.clipId}`);
        break;

      case "APPROVED":
        if (event.payload.ownerId) {
          await db.insert(notifications).values({
            userId: event.payload.ownerId,
            type: event.type,
            title: `คลิปผ่านการอนุมัติ`,
            message: `คลิป "${event.payload.clipName}" ได้รับการอนุมัติแล้ว 🎉`,
            linkUrl: `/projects/${event.payload.projectId}/clips/${event.payload.clipId}`
          }).catch(err => console.error("[IN-APP NOTIFY ERROR]", err));
        }
        await LinePersonalService.sendApproved(event.payload).catch((err) =>
          console.error("[NOTIFICATION ROUTER] Approved Failed", err)
        );
        await push(event.payload.ownerId, "คลิปผ่านการอนุมัติ", `คลิป \"${event.payload.clipName}\" ได้รับการอนุมัติแล้ว`, `/projects/${event.payload.projectId}/clips/${event.payload.clipId}`);
        break;

      case "TASK_ASSIGNED":
        if (event.payload.assigneeId) {
          await db.insert(notifications).values({
            userId: event.payload.assigneeId,
            type: event.type,
            title: `คุณได้รับมอบหมายงานใหม่`,
            message: `คลิป "${event.payload.clipName}" ถูกมอบหมายให้คุณตัดต่อ`,
            linkUrl: `/projects/${event.payload.projectId}/clips/${event.payload.clipId}`
          }).catch(err => console.error("[IN-APP NOTIFY ERROR]", err));
        }
        await LinePersonalService.sendTaskAssigned(event.payload).catch((err) =>
          console.error("[NOTIFICATION ROUTER] Task Assigned Failed", err)
        );
        await push(event.payload.assigneeId, "คุณได้รับมอบหมายงานใหม่", `คลิป \"${event.payload.clipName}\" ถูกมอบหมายให้คุณ`, `/projects/${event.payload.projectId}/clips/${event.payload.clipId}`);
        break;

      case "MULTI_TASK_ASSIGNED":
        if (event.payload.assigneeId) {
          await db.insert(notifications).values({
            userId: event.payload.assigneeId,
            type: "TASK_ASSIGNED",
            title: `คุณได้รับมอบหมายงานใหม่ (${event.payload.tasks.length} รายการ)`,
            message: `คลิปจำนวน ${event.payload.tasks.length} รายการ ถูกมอบหมายให้คุณตัดต่อ`,
            linkUrl: `/projects/${event.payload.projectId}`
          }).catch(err => console.error("[IN-APP NOTIFY ERROR]", err));
        }
        await LinePersonalService.sendTasksAssigned(event.payload).catch((err) =>
          console.error("[NOTIFICATION ROUTER] Multi Task Assigned Failed", err)
        );
        await push(event.payload.assigneeId, "คุณได้รับมอบหมายงานใหม่", `มีงานใหม่ ${event.payload.tasks.length} รายการ`, `/projects/${event.payload.projectId}`);
        break;

      case "LOGIN_SUCCESS":
        // Login success usually doesn't need in-app notification since they just logged in
        await LinePersonalService.sendLoginSuccess(event.payload).catch((err) =>
          console.error("[NOTIFICATION ROUTER] Login Success Failed", err)
        );
        break;

      case "PENDING_REVIEW":
        // This is a group notification, no specific user for in-app unless we broadcast to all Reviewers
        await LineGroupService.sendPendingReview(event.payload).catch((err) =>
          console.error("[NOTIFICATION ROUTER] Pending Review Group Failed", err)
        );
        await WebPushService.sendToRoles({ db, roles: ["REVIEWER", "ADMIN"], message: { title: "มีคลิปรอตรวจ", body: `มีคลิปของ ${event.payload.editorName || "สมาชิก"} ส่งเข้ารอตรวจ`, url: "/tasks" }, env });
        break;

      default:
        console.warn(`[NOTIFICATION ROUTER] Unknown event type: ${(event as any).type}`);
    }
  },
};
