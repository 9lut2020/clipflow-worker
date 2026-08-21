import { Hono, type Context } from "hono";
import { createDb } from "@clipflow/db";
import { ClipService } from "../services/clip.service";
import { RevisionService } from "../services/revision.service";

import { zValidator } from "@hono/zod-validator";
import { ClipSubmitRevisionSchema } from "@clipflow/validations";

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
  const status = c.req.query("status");
  const excludeApproved = c.req.query("excludeApproved") === "true";

  const allClips = await ClipService.listClips({
    db,
    episodeId,
    ownerId,
    status,
    excludeApproved,
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
