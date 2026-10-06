import { Hono, type Context } from "hono";
import { createDb, rawEvents, dailyMetrics } from "@clipflow/db";
import { asc, desc, eq, and, gte, lte, count } from "drizzle-orm";
import { adminOnly } from "../middleware/role";
import { handleApiError, paginated, parseDate, parseListQuery } from "../lib/api-contract";

export const analyticsRouter = new Hono<{
  Bindings: { DATABASE_URL: string };
  Variables: {
    db: ReturnType<typeof createDb>;
    user: { id: string; role: string; lineUserId: string };
  };
}>();

// authMiddleware already runs for every /api route; tracking is fire-and-forget
// so the client never waits on the insert.
analyticsRouter.post("/track", async (c: Context) => {
  const db = c.get("db");
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  const eventName = body?.eventName;
  if (!eventName || typeof eventName !== "string") {
    return c.json({ status: "error", message: "eventName is required" }, 400);
  }

  const insert = db.insert(rawEvents).values({
    eventName: eventName.slice(0, 100),
    userId: user.id,
    properties: body.properties || {},
    context: body.context || {},
  }).catch((error: unknown) => console.error("Analytics track error:", error));
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(insert);
  else await insert;

  return c.json({ status: "success" }, 202);
});

analyticsRouter.get("/metrics", adminOnly, async (c: Context) => {
  const db = c.get("db");
  try {
    const query = parseListQuery(c, { allowedSort: ["date", "metricName", "dimension", "createdAt"] as const, defaultSort: "date" });
    const filters: any[] = [];
    const from = parseDate(c.req.query("from"), "from"); const to = parseDate(c.req.query("to"), "to");
    if (from) filters.push(gte(dailyMetrics.date, from));
    if (to) filters.push(lte(dailyMetrics.date, to));
    if (c.req.query("metricName")) filters.push(eq(dailyMetrics.metricName, c.req.query("metricName")!));
    if (c.req.query("dimension")) filters.push(eq(dailyMetrics.dimension, c.req.query("dimension")!));
    const where = filters.length ? and(...filters) : undefined;
    const columns = { date: dailyMetrics.date, metricName: dailyMetrics.metricName, dimension: dailyMetrics.dimension, createdAt: dailyMetrics.createdAt };
    const order = query.sortOrder === "asc" ? asc : desc;
    const [items, totals] = await Promise.all([
      db.select().from(dailyMetrics).where(where).orderBy(order(columns[query.sortBy]), order(dailyMetrics.id)).limit(query.limit).offset(query.offset),
      db.select({ count: count() }).from(dailyMetrics).where(where),
    ]);
    return c.json({ status: "success", message: "Metrics retrieved successfully", data: paginated(items, Number(totals[0]?.count || 0), query.page, query.limit) });
  } catch (error: any) {
    return handleApiError(c, error);
  }
});
