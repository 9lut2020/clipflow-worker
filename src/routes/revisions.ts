import { Hono, type Context } from "hono";
import { createDb } from "@clipflow/db";
import { reviewerOrAdmin } from "../middleware/role";
import { RevisionService } from "../services/revision.service";
import { zValidator } from "@hono/zod-validator";
import { ReviewSubmitSchema } from "@clipflow/validations";

export const revisions = new Hono<{
  Bindings: { DATABASE_URL: string };
  Variables: { db: ReturnType<typeof createDb> };
}>();

/**
 * GET /revisions/:id
 * Single revision detail — includes clip (brief) + submittedBy
 */
revisions.get("/:id", async (c: Context) => {
  const db = c.get("db");
  const id = c.req.param("id") as string;

  const revision = await RevisionService.getRevision({ db, id });

  if (!revision) {
    return c.json(
      { status: "error", message: "Revision not found", data: null },
      404,
    );
  }

  return c.json({
    status: "success",
    message: "Revision retrieved successfully",
    data: revision,
  });
});

/**
 * GET /revisions/:id/reviews
 * List all reviews for a revision
 */
revisions.get("/:id/reviews", async (c: Context) => {
  const db = c.get("db");
  const id = c.req.param("id") as string;

  const allReviews = await RevisionService.getReviewsForRevision({ db, id });

  if (!allReviews) {
    return c.json(
      { status: "error", message: "Revision not found", data: null },
      404,
    );
  }

  return c.json({
    status: "success",
    message: "Reviews retrieved successfully",
    data: allReviews,
  });
});

/**
 * POST /revisions/:id/reviews
 * REVIEWER/ADMIN — submit a review for a specific revision (or clip)
 */
revisions.post("/:id/reviews", reviewerOrAdmin, zValidator("json", ReviewSubmitSchema), async (c) => {
  const db = c.get("db");
  const targetId = c.req.param("id") as string;
  const { status, comment, reviewerId, timecodeSeconds, timecodeStr } = c.req.valid("json");

  if (!status || !reviewerId) {
    return c.json(
      {
        status: "error",
        message: "Missing required fields: status, reviewerId",
        data: null,
      },
      400,
    );
  }

  try {
    const newReview = await RevisionService.submitReview({
      db,
      targetId,
      status,
      comment,
      reviewerId,
      timecodeSeconds: timecodeSeconds ?? undefined,
      timecodeStr: timecodeStr ?? undefined,
      fallbackReviewerName: c.get("user")?.name || "ทีมผู้ตรวจทาน",
      channelAccessToken: (c.env as any)?.LINE_CHANNEL_ACCESS_TOKEN,
      executionCtx: c.executionCtx,
    });

    return c.json(
      {
        status: "success",
        message: "Review submitted successfully",
        data: newReview,
      },
      201,
    );
  } catch (err: any) {
    console.error("Failed to submit review:", err);
    return c.json(
      {
        status: "error",
        message: err?.message || "Failed to submit review",
        data: null,
      },
      err?.message === "Revision or Clip not found" ? 404 : 500,
    );
  }
});

/**
 * PATCH /reviews/:reviewId
 * ADMIN — update a review comment
 */
revisions.patch("/reviews/:reviewId", reviewerOrAdmin, async (c: Context) => {
  const db = c.get("db");
  const reviewId = c.req.param("reviewId") as string;
  const body = await c.req.json();
  const { comment, status } = body as {
    comment?: string;
    status?: "NEEDS_REVISION" | "APPROVED";
  };

  const updatedReview = await RevisionService.updateReview({
    db,
    reviewId,
    comment,
    status,
  });

  if (!updatedReview) {
    return c.json(
      { status: "error", message: "Review not found", data: null },
      404,
    );
  }

  return c.json({
    status: "success",
    message: "Review updated successfully",
    data: updatedReview,
  });
});
