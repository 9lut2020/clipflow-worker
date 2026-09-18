import { Hono, type Context } from "hono";
import { createDb } from "@clipflow/db";
import { reviewerOrAdmin } from "../middleware/role";
import { RevisionService } from "../services/revision.service";
import { zValidator } from "@hono/zod-validator";
import { ReviewSubmitSchema } from "@clipflow/validations";
import { handleApiError, paginated, parseDate, parseListQuery, parseMultiValue } from "../lib/api-contract";

function canReadRevision(user: any, revision: any) {
  if (!user || !revision) return false;
  if (user.role === "ADMIN") return true;
  if (user.role === "USER") return revision.clip?.ownerId === user.id;
  return user.role === "REVIEWER" && !["DRAFT", "CANCELLED"].includes(revision.clip?.status);
}

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

  if (!canReadRevision(c.get("user"), revision)) {
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
  try {
    const db = c.get("db");
    const id = c.req.param("id") as string;
    const revision = await RevisionService.getRevision({ db, id });
    if (!canReadRevision(c.get("user"), revision)) return c.json({ status: "error", code: "NOT_FOUND", message: "Revision not found", data: null, errors: {} }, 404);
    const query = parseListQuery(c, { allowedSort: ["createdAt"] as const, defaultSort: "createdAt" });
    const result = await RevisionService.getReviewsForRevision({ db, id, status: parseMultiValue(c, "status"), reviewerId: c.req.query("reviewerId"), from: parseDate(c.req.query("from"), "from"), to: parseDate(c.req.query("to"), "to"), limit: query.limit, offset: query.offset, sortOrder: query.sortOrder });
    if (!result) return c.json({ status: "error", code: "NOT_FOUND", message: "Revision not found", data: null, errors: {} }, 404);
    return c.json({ status: "success", message: "Reviews retrieved successfully", data: paginated(result.items, result.total, query.page, query.limit) });
  } catch (error) { return handleApiError(c, error); }
});

/**
 * POST /revisions/:id/reviews
 * REVIEWER/ADMIN — submit a review for a specific revision (or clip)
 */
revisions.post("/:id/reviews", reviewerOrAdmin, zValidator("json", ReviewSubmitSchema), async (c) => {
  const db = c.get("db");
  const targetId = c.req.param("id") as string;
  const { status, comment, timecodeSeconds, timecodeStr } = c.req.valid("json");
  // Never trust an identity supplied by the browser. The authenticated
  // reviewer is the only actor allowed to create this review.
  const reviewerId = c.get("user")?.id;

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
        err?.message === "Revision or Clip not found" ? 404 :
          err?.message === "Clip is not ready for review" ? 409 : 500,
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
  const existing = await db.query.reviews.findFirst({ where: (row: any, { eq }: any) => eq(row.id, reviewId), columns: { id: true, reviewerId: true } });
  const actor = c.get("user");
  if (!existing || (actor?.role !== "ADMIN" && existing.reviewerId !== actor?.id)) return c.json({ status: "error", code: "NOT_FOUND", message: "Review not found", data: null, errors: {} }, 404);
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
