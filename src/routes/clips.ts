import { Hono, type Context } from "hono";
import { createDb } from "@clipflow/db";
import { ClipService } from "../services/clip.service";
import { RevisionService } from "../services/revision.service";
import { zValidator } from "@hono/zod-validator";
import { ClipSubmitRevisionSchema, ClipScheduleSchema, ClipFastSubmitSchema } from "@clipflow/validations";
import { logActivity } from "../services/activity-logger";
// Static imports — avoids re-loading on every request
import { eq, desc } from "drizzle-orm";
import { clips as clipsTable, clipPublishSchedules, publishedPosts, users } from "@clipflow/db";
import { apiError, handleApiError, paginated, parseDate, parseListQuery, parseMultiValue } from "../lib/api-contract";
import { adminOnly } from "../middleware/role";

export const clips = new Hono<{
  Bindings: { DATABASE_URL: string };
  Variables: { db: ReturnType<typeof createDb>; user?: any };
}>();

/**
 * GET /clips
 * List clips with filters.
 */
clips.get("/", async (c: Context) => {
  try {
    const query = parseListQuery(c, { allowedSort: ["createdAt", "updatedAt", "deadline", "scheduledPublishAt", "name"] as const, defaultSort: "createdAt" });
    const statuses = parseMultiValue(c, "status");
    const result = await ClipService.listClips({
      db: c.get("db"),
      hydrationDb: createDb(c.env.DATABASE_URL),
      user: c.get("user") as any,
      episodeId: c.req.query("episodeId"), projectId: c.req.query("projectId"), ownerId: c.req.query("ownerId"), videoSizeId: c.req.query("videoSizeId"),
      status: statuses.length ? statuses : undefined,
      excludeApproved: c.req.query("excludeApproved") === "true",
      scheduledState: c.req.query("scheduledState") as any, postingState: c.req.query("postingState") as any,
      scheduledFrom: parseDate(c.req.query("scheduledFrom"), "scheduledFrom"), scheduledTo: parseDate(c.req.query("scheduledTo"), "scheduledTo"),
      deadlineFrom: parseDate(c.req.query("deadlineFrom"), "deadlineFrom"), deadlineTo: parseDate(c.req.query("deadlineTo"), "deadlineTo"),
      createdFrom: parseDate(c.req.query("createdFrom"), "createdFrom"), createdTo: parseDate(c.req.query("createdTo"), "createdTo"),
      q: query.q, limit: query.limit, offset: query.offset, sortBy: query.sortBy, sortOrder: query.sortOrder,
    });
    return c.json({ status: "success", message: "Clips retrieved successfully", data: paginated(result.items, result.total, query.page, query.limit) });
  } catch (error) { return handleApiError(c, error); }
});

/**
 * GET /clips/:id
 * Clip detail — full context
 */
clips.get("/:id", async (c: Context) => {
  const db = c.get("db");
  const id = c.req.param("id") as string;

  const clip = await ClipService.getClip({ db, id, user: c.get("user") as any });

  if (!clip) {
    return c.json(
      { status: "error", message: "Clip not found", data: null },
      404,
    );
  }

  return c.json({
    status: "success",
    message: "Clip retrieved successfully",
    data: clip,
  });
});

/**
 * PATCH /clips/:id/schedule
 * Admin / Reviewer - Schedule publication date for a clip
 */
clips.patch(
  "/:id/schedule",
  adminOnly,
  zValidator("json", ClipScheduleSchema),
  async (c) => {
    const db = c.get("db");
    const id = c.req.param("id") as string;
    const body = c.req.valid("json");
    const actorId = c.get("user")?.id || null;

    try {
      const scheduledPublishAt = body.scheduledPublishAt 
        ? new Date(body.scheduledPublishAt) 
        : null;

      const targetClip = await db.query.clips.findFirst({
        where: (row: any, { eq }: any) => eq(row.id, id),
        columns: { id: true, name: true, projectId: true },
      });

      if (!targetClip) {
        return c.json(
          { status: "error", message: "Clip not found", data: null },
          404,
        );
      }

      if (scheduledPublishAt && Number.isNaN(scheduledPublishAt.getTime())) {
        return c.json(
          { status: "error", message: "Invalid publish date/time", data: null },
          400,
        );
      }

      if (scheduledPublishAt && !body.isRepeat) {
        const publishDate = scheduledPublishAt.toISOString().slice(0, 10);
        const sameDaySchedules = await db.query.clipPublishSchedules.findMany({
          where: (row: any, { eq, and }: any) => and(
            eq(row.projectId, targetClip.projectId),
            eq(row.publishDate, publishDate),
            eq(row.isRepeat, false),
          ),
          columns: { clipId: true },
        });

        if (sameDaySchedules.some((schedule: any) => schedule.clipId !== id)) {
          return c.json(
            { status: "error", message: "รายการนี้มีคลิปกำหนดโพสต์ในวันดังกล่าวแล้ว", data: { conflict: true } },
            409,
          );
        }
      }

      const [updated] = await db
        .update(clipsTable)
        .set({ 
          scheduledPublishAt,
          updatedAt: new Date()
        })
        .where(eq(clipsTable.id, id))
        .returning();

      if (scheduledPublishAt) {
        await db.insert(clipPublishSchedules).values({
          projectId: targetClip.projectId,
          clipId: id,
          publishDate: scheduledPublishAt.toISOString().slice(0, 10),
          publishTime: scheduledPublishAt.toISOString().slice(11, 19),
          isRepeat: body.isRepeat ?? false,
          note: body.note || null,
          createdBy: actorId,
        }).onConflictDoUpdate({
          target: clipPublishSchedules.clipId,
          set: {
            projectId: targetClip.projectId,
            publishDate: scheduledPublishAt.toISOString().slice(0, 10),
            publishTime: scheduledPublishAt.toISOString().slice(11, 19),
            isRepeat: body.isRepeat ?? false,
            note: body.note || null,
            status: "SCHEDULED",
            updatedAt: new Date(),
          },
        });
      } else {
        await db.delete(clipPublishSchedules).where(eq(clipPublishSchedules.clipId, id));
      }

      // Log activity
      await logActivity({
        db,
        actorId,
        action: "CLIP_SCHEDULED",
        entityType: "clip",
        entityId: id,
        meta: { 
          clipName: updated.name,
          scheduledPublishAt: updated.scheduledPublishAt
        },
      }).catch(() => {});

      return c.json({
        status: "success",
        message: "Clip schedule updated successfully",
        data: updated,
      });
    } catch (error: any) {
      console.error("Failed to update clip schedule:", error);
      return c.json(
        { status: "error", message: error.message || "Failed to update schedule", data: null },
        500,
      );
    }
  }
);

/**
 * GET /clips/:id/revisions
 * List all revisions for a clip with pagination and filters
 */
clips.get("/:id/revisions", async (c: Context) => {
  try {
    const db = c.get("db");
    const clipId = c.req.param("id") as string;
    const query = parseListQuery(c, {
      allowedSort: ["revisionNo", "submittedAt"] as const,
      defaultSort: "submittedAt",
    });
    const submittedBy = c.req.query("submittedBy");
    const from = parseDate(c.req.query("from"), "from");
    const to = parseDate(c.req.query("to"), "to");

    const visibleClip = await ClipService.getClip({ db, id: clipId, user: c.get("user") as any });
    if (!visibleClip) return apiError(c, 404, "NOT_FOUND", "Clip not found");
    const result = await RevisionService.getRevisionsForClip({ db, clipId, submittedBy, from, to, limit: query.limit, offset: query.offset, sortBy: query.sortBy, sortOrder: query.sortOrder });

    return c.json({
      status: "success",
      message: "Revisions retrieved successfully",
      data: paginated(result.items, result.total, query.page, query.limit),
    });
  } catch (error) {
    return handleApiError(c, error);
  }
});

/**
 * POST /clips/fast-submit
 * One-click submit: Create clip and Revision 1 immediately.
 */
clips.post("/fast-submit", zValidator("json", ClipFastSubmitSchema), async (c) => {
  const db = c.get("db");
  const { projectId, episodeId, name, driveUrl, submitNote } = c.req.valid("json");
  const userId = c.get("user")?.id;
  if (!userId) {
    return c.json({ status: "error", message: "Unauthorized", data: null }, 401);
  }

  try {
    // 1. Create the clip
    const [newClip] = await db
      .insert(clipsTable)
      .values({
        projectId,
        episodeId,
        name,
        ownerId: userId,
        createdBy: userId,
        status: "DRAFT",
      })
      .returning();

    // 2. Submit Revision 1 using existing logic
    const newRev = await RevisionService.submitRevision({
      db,
      clipId: newClip.id,
      driveUrl,
      submitNote,
      userId,
      channelAccessToken: (c.env as any)?.LINE_CHANNEL_ACCESS_TOKEN,
      adminGroupId: (c.env as any)?.LINE_ADMIN_GROUP_ID,
      executionCtx: c.executionCtx,
      pushEnv: c.env,
    });

    return c.json(
      {
        status: "success",
        message: "Clip created and revision submitted successfully",
        data: { clip: newClip, revision: newRev },
      },
      201,
    );
  } catch (err: any) {
    console.error("Failed to fast-submit:", err);
    return c.json(
      {
        status: "error",
        message: err?.message || "Failed to fast-submit",
        data: null,
      },
      500,
    );
  }
});

/**
 * POST /clips/:id/revisions
 * Submit a new revision for a clip (Editor/User or Admin)
 */
clips.post("/:id/revisions", zValidator("json", ClipSubmitRevisionSchema), async (c) => {
  const db = c.get("db");
  const clipId = c.req.param("id") as string;
  if (!clipId) {
    return c.json(
      { status: "error", message: "Missing clipId", data: null },
      400,
    );
  }

  const { driveUrl, submitNote } = c.req.valid("json");
  // The actor must come from the authenticated request, never from a browser
  // supplied submittedBy field.
  const userId = c.get("user")?.id;
  if (!userId) {
    return c.json({ status: "error", message: "Unauthorized", data: null }, 401);
  }

  try {
    const newRev = await RevisionService.submitRevision({
      db,
      clipId,
      driveUrl,
      submitNote,
      userId,
      channelAccessToken: (c.env as any)?.LINE_CHANNEL_ACCESS_TOKEN,
      adminGroupId: (c.env as any)?.LINE_ADMIN_GROUP_ID,
      executionCtx: c.executionCtx,
      pushEnv: c.env,
    });

    return c.json(
      {
        status: "success",
        message: "Revision submitted successfully",
        data: newRev,
      },
      201,
    );
  } catch (err: any) {
    console.error("Failed to insert revision:", err);
    return c.json(
      {
        status: "error",
        message: err?.message || "Failed to submit revision",
        data: null,
      },
      500,
    );
  }
});

/**
 * DELETE /clips/:id
 * Delete a clip by ID
 */
clips.delete("/:id", adminOnly, async (c: Context) => {
  const db = c.get("db");
  const id = c.req.param("id") as string;

  try {
    const result = await db.delete(clipsTable).where(eq(clipsTable.id, id)).returning();

    if (result.length === 0) {
      return c.json({ status: "error", message: "Clip not found or already deleted", data: null }, 404);
    }

    return c.json({ status: "success", message: "Clip deleted successfully", data: result[0] });
  } catch (err: any) {
    console.error("Failed to delete clip:", err);
    return c.json({ status: "error", message: "Failed to delete clip", data: null }, 500);
  }
});

/**
 * GET /clips/:id/published-posts
 * List all published posts for a clip — ADMIN only, paginated
 */
clips.get("/:id/published-posts", adminOnly, async (c: Context) => {
  try {
    const db = c.get("db");
    const clipId = c.req.param("id") as string;
    const query = parseListQuery(c, {
      allowedSort: ["publishedAt"] as const,
      defaultSort: "publishedAt",
    });
    const platformFilter = c.req.query("platform");
    const from = parseDate(c.req.query("from"), "from");
    const to = parseDate(c.req.query("to"), "to");

    const { gte, lte } = await import("drizzle-orm");

    const conditions: any[] = [eq(publishedPosts.clipId, clipId)];
    if (platformFilter) conditions.push(eq(publishedPosts.platform, platformFilter as any));
    if (from) conditions.push(gte(publishedPosts.publishedAt, new Date(`${from}T00:00:00Z`)));
    if (to) conditions.push(lte(publishedPosts.publishedAt, new Date(`${to}T23:59:59Z`)));
    const where = conditions.length ? (await import("drizzle-orm")).and(...conditions) : eq(publishedPosts.clipId, clipId);

    const dir = query.sortOrder === "asc" ? (await import("drizzle-orm")).asc : desc;

    const [posts, totalRows] = await Promise.all([
      db.select({
        id: publishedPosts.id,
        clipId: publishedPosts.clipId,
        platform: publishedPosts.platform,
        caption: publishedPosts.caption,
        url: publishedPosts.url,
        publishedAt: publishedPosts.publishedAt,
        publishedBy: users.displayName,
      })
      .from(publishedPosts)
      .leftJoin(users, eq(publishedPosts.publishedBy, users.id))
      .where(where)
      .orderBy(dir(publishedPosts.publishedAt))
      .limit(query.limit)
      .offset(query.offset),
      db.select({ count: (await import("drizzle-orm")).sql<number>`count(*)::int` })
        .from(publishedPosts)
        .where(where),
    ]);

    return c.json({
      status: "success",
      message: "Published posts retrieved",
      data: paginated(posts, Number(totalRows[0].count), query.page, query.limit),
    });
  } catch (err: any) {
    console.error("Failed to fetch published posts:", err);
    return c.json({ status: "error", message: "Failed to fetch published posts", data: null }, 500);
  }
});

/**
 * POST /clips/:id/publish
 * Record a new published post
 */
clips.post("/:id/publish", adminOnly, async (c: Context) => {
  const db = c.get("db");
  const clipId = c.req.param("id") as string;

  try {
    const body = await c.req.json();
    const { platform, caption, url, publishedAt, publishedBy } = body;

    const userId = c.get("user")?.id || publishedBy;
    if (!userId) {
      return c.json({ status: "error", message: "User ID required", data: null }, 401);
    }

    // 1. Insert published post record
    const result = await db.insert(publishedPosts).values({
      clipId,
      platform,
      caption,
      url,
      publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
      publishedBy: userId,
    }).returning();

    // 2. Update clip status to PUBLISHED
    await db.update(clipsTable)
      .set({ status: "PUBLISHED", updatedAt: new Date() })
      .where(eq(clipsTable.id, clipId));

    const platformRows = await db
      .select({ platform: publishedPosts.platform })
      .from(publishedPosts)
      .where(eq(publishedPosts.clipId, clipId));
    const requiredPlatforms = new Set([
      "TIKTOK",
      "YOUTUBE_SHORTS",
      "FACEBOOK_REELS",
      "INSTAGRAM_REELS",
    ]);
    const publishedPlatforms = new Set(
      platformRows.map((post: { platform: string }) => post.platform),
    );
    const isFullyPublished = Array.from(requiredPlatforms).every((platform) =>
      publishedPlatforms.has(platform),
    );
    if (isFullyPublished) {
      await db
        .update(clipPublishSchedules)
        .set({ status: "PUBLISHED", updatedAt: new Date() })
        .where(eq(clipPublishSchedules.clipId, clipId));
    }

    return c.json({ status: "success", message: "Recorded published post", data: result[0] }, 201);
  } catch (err: any) {
    console.error("Failed to record publish:", err);
    return c.json({ status: "error", message: err.message || "Failed to record publish", data: null }, 500);
  }
});
