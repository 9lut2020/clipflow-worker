import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { assets } from "@clipflow/db";
import { desc, eq } from "drizzle-orm";

export const assetsRouter = new Hono<{
  Bindings: any;
  Variables: { db: any; user: any };
}>();

const assetCategoryEnum = z.enum(["LOGO", "BGM", "FONT", "TEMPLATE", "OTHER"]);

// GET /api/assets
assetsRouter.get(
  "/",
  zValidator(
    "query",
    z.object({
      category: assetCategoryEnum.optional(),
      isActive: z
        .string()
        .optional()
        .transform((v) => (v === "true" ? true : v === "false" ? false : undefined)),
    }),
  ),
  async (c) => {
    const db = c.get("db");
    const { category, isActive } = c.req.valid("query");

    const conditions: any[] = [];
    if (category) conditions.push(eq(assets.category, category));
    if (isActive !== undefined) conditions.push(eq(assets.isActive, isActive));

    const query = db
      .select()
      .from(assets)
      .orderBy(desc(assets.createdAt));

    if (conditions.length > 0) {
      query.where(conditions.length === 1 ? conditions[0] : require("drizzle-orm").and(...conditions));
    }

    const items = await query;
    return c.json({ status: "success", message: "Assets retrieved", data: items });
  },
);

// POST /api/assets (Admin only)
assetsRouter.post(
  "/",
  zValidator(
    "json",
    z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      category: assetCategoryEnum,
      fileUrl: z.string().url(),
      isActive: z.boolean().default(true),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (user.role !== "ADMIN") return c.json({ status: "error", message: "Forbidden" }, 403);

    const db = c.get("db");
    const body = c.req.valid("json");

    const [newAsset] = await db
      .insert(assets)
      .values({ ...body, createdById: user.id })
      .returning();

    return c.json({ status: "success", message: "Asset created", data: newAsset });
  },
);

// PATCH /api/assets/:id (Admin only)
assetsRouter.patch(
  "/:id",
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      category: assetCategoryEnum.optional(),
      fileUrl: z.string().url().optional(),
      isActive: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (user.role !== "ADMIN") return c.json({ status: "error", message: "Forbidden" }, 403);

    const db = c.get("db");
    const id = c.req.param("id");
    const body = c.req.valid("json");

    if (Object.keys(body).length === 0) return c.json({ status: "error", message: "No data" }, 400);

    const [updated] = await db
      .update(assets)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(assets.id, id))
      .returning();

    if (!updated) return c.json({ status: "error", message: "Asset not found" }, 404);

    return c.json({ status: "success", message: "Asset updated", data: updated });
  },
);

// DELETE /api/assets/:id (Admin only)
assetsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  if (user.role !== "ADMIN") return c.json({ status: "error", message: "Forbidden" }, 403);

  const db = c.get("db");
  const id = c.req.param("id");

  const [deleted] = await db.delete(assets).where(eq(assets.id, id)).returning();
  if (!deleted) return c.json({ status: "error", message: "Asset not found" }, 404);

  return c.json({ status: "success", message: "Asset deleted" });
});
