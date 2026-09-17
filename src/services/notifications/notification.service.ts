import { NotificationRouter, NotificationEvent } from "./notification-router";
import { createDb } from "@clipflow/db";

export const NotificationService = {
  /**
   * Dispatches a notification event asynchronously.
   * This should be called AFTER the database transaction has successfully committed.
   */
  dispatch(event: NotificationEvent, db: ReturnType<typeof createDb>, env?: Record<string, unknown>): Promise<void> {
    return NotificationRouter.route(event, db, env).catch((err) => {
      console.error("[NOTIFICATION SERVICE] Dispatch failed critically", err);
    });
  },
};
