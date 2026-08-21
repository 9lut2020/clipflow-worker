/**
 * activity-logger.ts
 * Centralized service for writing audit log entries to the activity_logs table.
 */

import { activityLogs } from "@clipflow/db";

export type ActivityAction =
  | "CLIP_SUBMITTED"
  | "CLIP_RESUBMITTED"
  | "CLIP_APPROVED"
  | "CLIP_REJECTED"
  | "TASK_ASSIGNED"
  | "ROLE_CHANGED"
  | "STATUS_CHANGED"
  | "PROJECT_CREATED";

interface LogActivityParams {
  db: any; // Accepts either global db or tx instance
  actorId?: string | null;
  action: ActivityAction;
  entityType: "clip" | "user" | "project";
  entityId: string;
  meta?: Record<string, unknown>;
}

/**
 * Write a single audit log entry.
 * This MUST run within a database transaction. If it fails, it will throw and rollback the transaction.
 */
export async function logActivity({
  db,
  actorId,
  action,
  entityType,
  entityId,
  meta,
}: LogActivityParams): Promise<void> {
  await db.insert(activityLogs).values({
    actorId: actorId || null,
    action,
    entityType,
    entityId,
    meta: meta ? JSON.stringify(meta) : null,
  });
}
