/**
 * GET /activity-logs
 * ADMIN-only: returns paginated audit log entries with actor info.
 */

import { Hono, type Context } from "hono";
import { eq, desc } from "drizzle-orm";
import { createDb, activityLogs, users as usersSchema } from "@clipflow/db";
import { adminOnly } from "../middleware/role";

export const activityLogsRouter = new Hono<{
  Bindings: { DATABASE_URL: string };
  Variables: { db: ReturnType<typeof createDb> };
}>();

activityLogsRouter.get("/", adminOnly, async (c: Context) => {
  const db = c.get("db");

  const rawLogs = await db
    .select({
      id: activityLogs.id,
      action: activityLogs.action,
      entityType: activityLogs.entityType,
      entityId: activityLogs.entityId,
      meta: activityLogs.meta,
      createdAt: activityLogs.createdAt,
      actorId: activityLogs.actorId,
      actorName: usersSchema.displayName,
      actorPictureUrl: usersSchema.pictureUrl,
    })
    .from(activityLogs)
    .leftJoin(usersSchema, eq(activityLogs.actorId, usersSchema.id))
    .orderBy(desc(activityLogs.createdAt))
    .limit(200);

  const logs = rawLogs.map((log: any) => ({
    ...log,
    meta: log.meta ? (() => { try { return JSON.parse(log.meta); } catch { return {}; } })() : {},
    actor: log.actorName
      ? { name: log.actorName, pictureUrl: log.actorPictureUrl }
      : null,
  }));

  return c.json({ status: "success", data: logs });
});
