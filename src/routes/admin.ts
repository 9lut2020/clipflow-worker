import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { auditLogs, users, clips, revisions } from "@clipflow/db";
import { desc, eq, and, sql } from "drizzle-orm";

export const adminRouter = new Hono<{
  Bindings: any;
  Variables: { db: any; user: any };
}>();

// Ensure the user is an ADMIN
adminRouter.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user || user.role !== "ADMIN") {
    return c.json({ success: false, error: "Unauthorized. Admin only." }, 403);
  }
  await next();
});

// GET /api/admin/audit-logs
adminRouter.get(
  "/audit-logs",
  zValidator(
    "query",
    z.object({
      page: z.string().optional().default("1"),
      limit: z.string().optional().default("20"),
      userId: z.string().optional(),
      clipId: z.string().optional(),
      action: z.string().optional(),
    }),
  ),
  async (c) => {
    const db = c.get("db");
    const { page, limit, userId, clipId, action } = c.req.valid("query");

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (userId) conditions.push(eq(auditLogs.userId, userId));
    if (clipId) conditions.push(eq(auditLogs.clipId, clipId));
    if (action) conditions.push(eq(auditLogs.action, action as any));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(whereClause);
    const total = Number(totalResult[0]?.count || 0);

    // Get paginated data with joins
    const data = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        oldStatus: auditLogs.oldStatus,
        newStatus: auditLogs.newStatus,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
        user: {
          id: users.id,
          displayName: users.displayName,
          pictureUrl: users.pictureUrl,
          role: users.role,
        },
        clip: {
          id: clips.id,
          name: clips.name,
        },
        revision: {
          id: revisions.id,
          revisionNo: revisions.revisionNo,
        },
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .leftJoin(clips, eq(auditLogs.clipId, clips.id))
      .leftJoin(revisions, eq(auditLogs.revisionId, revisions.id))
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limitNum)
      .offset(offset);

    return c.json({
      success: true,
      data,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  },
);

// GET /api/admin/audit-logs/summary
adminRouter.get("/audit-logs/summary", async (c) => {
  const db = c.get("db");

  // Basic summary: total logs, today's logs
  const totalResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditLogs);
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditLogs)
    .where(sql`${auditLogs.createdAt} >= ${today.toISOString()}`);

  return c.json({
    success: true,
    data: {
      totalLogs: Number(totalResult[0]?.count || 0),
      todayLogs: Number(todayResult[0]?.count || 0),
    },
  });
});
