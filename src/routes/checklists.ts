import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { checklists } from "@clipflow/db";
import { desc, eq, asc } from "drizzle-orm";

export const checklistsRouter = new Hono<{
  Bindings: any;
  Variables: { db: any; user: any };
}>();

// GET /api/checklists
checklistsRouter.get(
  "/",
  zValidator(
    "query",
    z.object({
      projectId: z.string().uuid().optional(),
      isActive: z
        .string()
        .optional()
        .transform((v) => (v === "true" ? true : v === "false" ? false : undefined)),
    }),
  ),
  async (c) => {
    const db = c.get("db");
    const { projectId, isActive } = c.req.valid("query");

    const conditions: any[] = [];
    
    // If projectId is provided, we might want to return global checklists (projectId is null) AND project-specific ones
    // Or just exact match. Let's do exact match + global if projectId provided.
    // For simplicity, let's just use exact match for now. If frontend wants global, it sends no projectId.
    if (projectId) {
      conditions.push(eq(checklists.projectId, projectId));
    } else {
      conditions.push(require("drizzle-orm").isNull(checklists.projectId)); // Global
    }
    
    if (isActive !== undefined) conditions.push(eq(checklists.isActive, isActive));

    const query = db
      .select()
      .from(checklists)
      .orderBy(asc(checklists.order), desc(checklists.createdAt));

    if (conditions.length > 0) {
      query.where(conditions.length === 1 ? conditions[0] : require("drizzle-orm").and(...conditions));
    }

    const items = await query;
    return c.json({ status: "success", message: "Checklists retrieved", data: items });
  },
);

// POST /api/checklists (Admin only)
checklistsRouter.post(
  "/",
  zValidator(
    "json",
    z.object({
      text: z.string().min(1),
      projectId: z.string().uuid().optional().nullable(),
      order: z.number().int().default(0),
      isActive: z.boolean().default(true),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (user.role !== "ADMIN") return c.json({ status: "error", message: "Forbidden" }, 403);

    const db = c.get("db");
    const body = c.req.valid("json");

    const [newChecklist] = await db
      .insert(checklists)
      .values({ ...body })
      .returning();

    return c.json({ status: "success", message: "Checklist created", data: newChecklist });
  },
);

// PATCH /api/checklists/:id (Admin only)
checklistsRouter.patch(
  "/:id",
  zValidator(
    "json",
    z.object({
      text: z.string().min(1).optional(),
      projectId: z.string().uuid().optional().nullable(),
      order: z.number().int().optional(),
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
      .update(checklists)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(checklists.id, id))
      .returning();

    if (!updated) return c.json({ status: "error", message: "Checklist not found" }, 404);

    return c.json({ status: "success", message: "Checklist updated", data: updated });
  },
);

// DELETE /api/checklists/:id (Admin only)
checklistsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  if (user.role !== "ADMIN") return c.json({ status: "error", message: "Forbidden" }, 403);

  const db = c.get("db");
  const id = c.req.param("id");

  const [deleted] = await db.delete(checklists).where(eq(checklists.id, id)).returning();
  if (!deleted) return c.json({ status: "error", message: "Checklist not found" }, 404);

  return c.json({ status: "success", message: "Checklist deleted" });
});
