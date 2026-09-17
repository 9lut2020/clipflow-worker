import { Hono } from "hono";
import { eq, asc } from "drizzle-orm";
import { createDb, videoSizes, clips } from "@clipflow/db";
import { adminOnly } from "../middleware/role";

export const videoSizesRouter = new Hono<{
  Bindings: { DATABASE_URL: string };
  Variables: { db: ReturnType<typeof createDb> };
}>();

videoSizesRouter.get("/", async (c) => {
  const rows = await c.get("db").select().from(videoSizes).orderBy(asc(videoSizes.name));
  return c.json({ status: "success", data: rows });
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
