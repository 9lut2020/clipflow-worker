import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { activityLogs, users } from "@clipflow/db";
import { desc, eq, and, sql, ilike, or, gte, lte } from "drizzle-orm";
import { paginated } from "../lib/api-contract";

export const adminRouter = new Hono<{
  Bindings: any;
  Variables: { db: any; user: any };
}>();

adminRouter.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user || user.role !== "ADMIN") return c.json({ status: "error", code: "FORBIDDEN", message: "Admin only", data: null, errors: {} }, 403);
  await next();
});

const documentedRoutes: Array<[string, string, string]> = [
  ["/api/projects", "get", "List scoped projects"], ["/api/projects/{id}", "get", "Get project detail"], ["/api/projects/{id}/clips", "get", "List project clips"], ["/api/projects/{id}/members", "get", "List project members"],
  ["/api/episodes", "get", "List scoped episodes"], ["/api/episodes/{id}", "get", "Get episode detail"], ["/api/episodes/{id}/clips", "get", "List episode clips"],
  ["/api/clips", "get", "List scoped clips"], ["/api/clips/{id}", "get", "Get clip detail"], ["/api/clips/{id}/revisions", "get", "List clip revisions"], ["/api/clips/{id}/published-posts", "get", "List published posts"],
  ["/api/revisions/{id}", "get", "Get revision detail"], ["/api/revisions/{id}/reviews", "get", "List revision reviews"],
  ["/api/users", "get", "List users"], ["/api/notifications", "get", "List current user notifications"], ["/api/video-sizes", "get", "List video sizes"],
  ["/api/publish-schedules/summary", "get", "Publish summary"], ["/api/publish-schedules/items", "get", "List publish work items"], ["/api/publish-schedules/slots", "get", "List recurring project slots"], ["/api/publish-schedules/queue", "get", "List publish queue"],
  ["/api/analytics/metrics", "get", "List analytics metrics"], ["/api/admin/audit-logs", "get", "List audit logs"],
];

const openApiPaths = Object.fromEntries(documentedRoutes.map(([path, method, summary]) => [path, { [method]: { summary, security: [{ UserHeaders: [] }], parameters: method === "get" ? [{ name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } }] : [], responses: { "200": { description: "Successful response" }, "400": { description: "Invalid query or payload" }, "401": { description: "Unauthenticated" }, "403": { description: "Forbidden" }, "404": { description: "Not found" } } } }]));

adminRouter.get("/openapi.json", (c) => c.json({ openapi: "3.0.3", info: { title: "ClipFlow API", version: "1.0.0", description: "Backend-filtered, paginated API contract" }, servers: [{ url: "/" }], components: { securitySchemes: { UserHeaders: { type: "apiKey", in: "header", name: "x-user-id" } }, schemas: { Pagination: { type: "object", required: ["page", "limit", "total", "totalPages", "hasNext", "hasPrevious"], properties: { page: { type: "integer" }, limit: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" }, hasNext: { type: "boolean" }, hasPrevious: { type: "boolean" } } }, Error: { type: "object", required: ["status", "code", "message"], properties: { status: { type: "string", enum: ["error"] }, code: { type: "string" }, message: { type: "string" }, data: { nullable: true }, errors: { type: "object" } } } } }, paths: openApiPaths }));
adminRouter.get("/docs", swaggerUI({ url: "/api/admin/openapi.json" }));

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
      q: z.string().max(100).optional(),
      actorId: z.string().optional(),
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
  ),
  async (c) => {
    const db = c.get("db");
    const { page, limit, userId, clipId, action, q, actorId, entityType, entityId, from, to } = c.req.valid("query");

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    if (pageNum < 1 || limitNum < 1 || limitNum > 100) return c.json({ status: "error", code: "VALIDATION_ERROR", message: "Invalid pagination", data: null, errors: {} }, 400);
    const conditions: any[] = [];
    if (userId || actorId) conditions.push(eq(activityLogs.actorId, actorId || userId!));
    if (clipId || entityId) conditions.push(eq(activityLogs.entityId, entityId || clipId!));
    if (entityType) conditions.push(eq(activityLogs.entityType, entityType));
    if (action) conditions.push(eq(activityLogs.action, action as any));
    if (q) conditions.push(or(ilike(activityLogs.action, `%${q}%`), ilike(activityLogs.entityType, `%${q}%`), ilike(activityLogs.meta, `%${q}%`)));
    if (from) conditions.push(gte(activityLogs.createdAt, new Date(`${from}T00:00:00+07:00`)));
    if (to) conditions.push(lte(activityLogs.createdAt, new Date(`${to}T23:59:59+07:00`)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(activityLogs)
      .where(whereClause);
    const total = Number(totalResult[0]?.count || 0);

    // Get paginated data with joins
    const data = await db
      .select({
        id: activityLogs.id,
        action: activityLogs.action,
        entityType: activityLogs.entityType,
        entityId: activityLogs.entityId,
        meta: activityLogs.meta,
        createdAt: activityLogs.createdAt,
        actorId: activityLogs.actorId,
        actorName: users.displayName,
        actorPictureUrl: users.pictureUrl,
      })
      .from(activityLogs)
      .leftJoin(users, eq(activityLogs.actorId, users.id))
      .where(whereClause)
      .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
      .limit(limitNum)
      .offset(offset);

    const items = data.map((row: any) => ({ ...row, meta: row.meta ? (() => { try { return JSON.parse(row.meta); } catch { return {}; } })() : {}, actor: row.actorName ? { id: row.actorId, name: row.actorName, displayName: row.actorName, pictureUrl: row.actorPictureUrl } : null }));
    return c.json({ status: "success", message: "Audit logs retrieved successfully", data: paginated(items, total, pageNum, limitNum) });
  },
);

// GET /api/admin/audit-logs/summary
adminRouter.get("/audit-logs/summary", async (c) => {
  const db = c.get("db");

  // Basic summary: total logs, today's logs
  const totalResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(activityLogs);
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(activityLogs)
    .where(sql`${activityLogs.createdAt} >= ${today.toISOString()}`);

  return c.json({
    status: "success",
    message: "Audit summary retrieved successfully",
    data: {
      totalLogs: Number(totalResult[0]?.count || 0),
      todayLogs: Number(todayResult[0]?.count || 0),
    },
  });
});
