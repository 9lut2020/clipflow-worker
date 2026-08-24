import { Hono, type Context } from "hono";
import { createDb } from "@clipflow/db";
import { ClipService } from "../services/clip.service";
import { RevisionService } from "../services/revision.service";
import { zValidator } from "@hono/zod-validator";
import { ClipSubmitRevisionSchema, ClipScheduleSchema } from "@clipflow/validations";
import { logActivity } from "../services/activity-logger";
// Static imports — avoids re-loading on every request
import { eq, desc } from "drizzle-orm";
import { clips as clipsTable, publishedPosts, users } from "@clipflow/db";

export const clips = new Hono<{
  Bindings: { DATABASE_URL: string };
  Variables: { db: ReturnType<typeof createDb>; user?: any };
}>();

/**
 * GET /clips
 * List clips with filters.
 */
clips.get("/", async (c: Context) => {
  const db = c.get("db");
  const episodeId = c.req.query("episodeId");
  const ownerId = c.req.query("ownerId");
  const statusParam = c.req.query("status");
  const status = statusParam?.includes(",") ? statusParam.split(",") : statusParam;
  const excludeApproved = c.req.query("excludeApproved") === "true";

  const limitStr = c.req.query("limit");
  const offsetStr = c.req.query("offset");
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;
  const offset = offsetStr ? parseInt(offsetStr, 10) : undefined;

  const allClips = await ClipService.listClips({
    db,
    episodeId,
    ownerId,
    status,
    excludeApproved,
    limit,
    offset,
  });

  return c.json({
    status: "success",
    message: "Clips retrieved successfully",
    data: allClips,
  });
});

/**
 * GET /clips/:id
 * Clip detail — full context
 */
clips.get("/:id", async (c: Context) => {
  const db = c.get("db");
  const id = c.req.param("id") as string;

  const clip = await ClipService.getClip({ db, id });

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

      const [updated] = await db
        .update(clipsTable)
        .set({ 
          scheduledPublishAt,
          updatedAt: new Date()
        })
        .where(eq(clipsTable.id, id))
        .returning();

      if (!updated) {
        return c.json(
          { status: "error", message: "Clip not found", data: null },
          404,
        );
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
 * List all revisions for a clip (ordered by revisionNo desc)
 */
clips.get("/:id/revisions", async (c: Context) => {
  const db = c.get("db");
  const clipId = c.req.param("id") as string;

  const allRevisions = await RevisionService.getRevisionsForClip({ db, clipId });

  return c.json({
    status: "success",
    message: "Revisions retrieved successfully",
    data: allRevisions,
  });
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

  const { driveUrl, submitNote, submittedBy } = c.req.valid("json");
  const userId = c.get("user")?.id || submittedBy || "unknown";

  try {
    const newRev = await RevisionService.submitRevision({
      db,
      clipId,
      driveUrl,
      submitNote,
      userId,
      channelAccessToken: (c.env as any)?.LINE_CHANNEL_ACCESS_TOKEN,
      executionCtx: c.executionCtx,
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
clips.delete("/:id", async (c: Context) => {
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
 * List all published posts for a clip
 */
clips.get("/:id/published-posts", async (c: Context) => {
  const db = c.get("db");
  const clipId = c.req.param("id") as string;

  try {
    const posts = await db.select({
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
    .where(eq(publishedPosts.clipId, clipId))
    .orderBy(desc(publishedPosts.publishedAt));

    return c.json({ status: "success", message: "Published posts retrieved", data: posts });
  } catch (err: any) {
    console.error("Failed to fetch published posts:", err);
    return c.json({ status: "error", message: "Failed to fetch published posts", data: null }, 500);
  }
});

/**
 * POST /clips/:id/publish
 * Record a new published post
 */
clips.post("/:id/publish", async (c: Context) => {
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

    return c.json({ status: "success", message: "Recorded published post", data: result[0] }, 201);
  } catch (err: any) {
    console.error("Failed to record publish:", err);
    return c.json({ status: "error", message: err.message || "Failed to record publish", data: null }, 500);
  }
});
