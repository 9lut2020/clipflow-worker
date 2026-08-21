import { Hono, type Context } from "hono";
import { createDb, rawEvents, dailyMetrics } from "@clipflow/db";
import { desc, eq, and, gte } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";

export const analyticsRouter = new Hono<{
  Bindings: { DATABASE_URL: string };
  Variables: {
    db: ReturnType<typeof createDb>;
    user: { id: string; role: string; lineUserId: string };
  };
}>();

analyticsRouter.post("/track", authMiddleware, async (c: Context) => {
  const db = c.get("db");
  const user = c.get("user");
  
  try {
    const body = await c.req.json();
    const { eventName, properties, context } = body;
    
    if (!eventName) {
      return c.json({ status: "error", message: "event_name is required" }, 400);
    }
    
    await db.insert(rawEvents).values({
      eventName,
      userId: user.id,
      properties: properties || {},
      context: context || {}
    });
    
    return c.json({ status: "success" });
  } catch (error: any) {
    console.error("Analytics track error:", error);
    return c.json({ status: "error", message: "Failed to track event" }, 500);
  }
});

analyticsRouter.get("/metrics", authMiddleware, async (c: Context) => {
  const db = c.get("db");
  try {
    const daysStr = c.req.query("days") || "30";
    const days = parseInt(daysStr, 10);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);

    // Fetch pre-aggregated daily metrics
    const metrics = await db.query.dailyMetrics.findMany({
      where: (m: any, { gte }: any) => gte(m.date, fromDate.toISOString().split('T')[0]),
      orderBy: (m: any, { asc }: any) => asc(m.date)
    });

    return c.json({ status: "success", data: metrics });
  } catch (error: any) {
    console.error("Analytics fetch error:", error);
    return c.json({ status: "error", message: "Failed to fetch metrics" }, 500);
  }
});
