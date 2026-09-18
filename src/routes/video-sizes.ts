import { Hono } from "hono";
import { and, eq, asc, desc, count, ilike, or, sql } from "drizzle-orm";
import { createDb, videoSizes, clips } from "@clipflow/db";
import { adminOnly } from "../middleware/role";
import { handleApiError, paginated, parseListQuery, parseOptionalBoolean } from "../lib/api-contract";

export const videoSizesRouter = new Hono<{
  Bindings: { DATABASE_URL: string };
  Variables: { db: ReturnType<typeof createDb> };
}>();

videoSizesRouter.get("/", async (c) => {
  try {
    const query = parseListQuery(c, { allowedSort: ["name", "width", "height", "createdAt"] as const, defaultSort: "name" });
    const filters: any[] = [];
    if (query.q) filters.push(ilike(videoSizes.name, `%${query.q}%`));
    const isActive = parseOptionalBoolean(c.req.query("isActive"));
    if (isActive !== undefined) filters.push(eq(videoSizes.isActive, isActive));
    const orientation = c.req.query("orientation");
    if (orientation === "portrait") filters.push(sql`${videoSizes.height} > ${videoSizes.width}`);
    if (orientation === "landscape") filters.push(sql`${videoSizes.width} > ${videoSizes.height}`);
    if (orientation === "square") filters.push(eq(videoSizes.width, videoSizes.height));
    const where = filters.length ? and(...filters) : undefined;
    const sortColumns = { name: videoSizes.name, width: videoSizes.width, height: videoSizes.height, createdAt: videoSizes.createdAt };
    const order = query.sortOrder === "asc" ? asc : desc;
    const [rows, totals] = await Promise.all([
      c.get("db").select().from(videoSizes).where(where).orderBy(order(sortColumns[query.sortBy]), order(videoSizes.id)).limit(query.limit).offset(query.offset),
      c.get("db").select({ count: count() }).from(videoSizes).where(where),
    ]);
    return c.json({ status: "success", message: "Video sizes retrieved successfully", data: paginated(rows, Number(totals[0]?.count || 0), query.page, query.limit) });
  } catch (error) { return handleApiError(c, error); }
});

videoSizesRouter.post("/", adminOnly, async (c) => {
  const body = await c.req.json();
  const name = String(body.name || "").trim();
  const width = Number(body.width);
  const height = Number(body.height);
  if (!name || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return c.json({ status: "error", message: "name, width and height are required" }, 400);
  }
  const [row] = await c.get("db").insert(videoSizes).values({ name, width, height }).returning();
  return c.json({ status: "success", data: row }, 201);
});

videoSizesRouter.patch("/:id", adminOnly, async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ status: "error", message: "Video size id is required" }, 400);
  const body = await c.req.json();
  const values: any = { updatedAt: new Date() };
  if (body.name !== undefined) values.name = String(body.name).trim();
  if (body.width !== undefined) values.width = Number(body.width);
  if (body.height !== undefined) values.height = Number(body.height);
  if (body.isActive !== undefined) values.isActive = Boolean(body.isActive);
  const [row] = await c.get("db").update(videoSizes).set(values).where(eq(videoSizes.id, id)).returning();
  return row ? c.json({ status: "success", data: row }) : c.json({ status: "error", message: "Video size not found" }, 404);
});

videoSizesRouter.delete("/:id", adminOnly, async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ status: "error", message: "Video size id is required" }, 400);
  const used = await c.get("db").select({ id: clips.id }).from(clips).where(eq(clips.videoSizeId, id)).limit(1);
  if (used.length) {
    const [row] = await c.get("db").update(videoSizes).set({ isActive: false, updatedAt: new Date() }).where(eq(videoSizes.id, id)).returning();
    return row ? c.json({ status: "success", data: row, message: "Deactivated because clips still use this size" }) : c.json({ status: "error", message: "Video size not found" }, 404);
  }
  const [row] = await c.get("db").delete(videoSizes).where(eq(videoSizes.id, id)).returning();
  return row ? c.json({ status: "success", data: row }) : c.json({ status: "error", message: "Video size not found" }, 404);
});
