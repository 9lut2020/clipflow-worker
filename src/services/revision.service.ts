import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  clips as clipsSchema,
  revisions as revisionsSchema,
  reviews as reviewsSchema,
  runBatch,
} from "@clipflow/db";
import { logActivity } from "./activity-logger";
import { NotificationService } from "./notifications/notification.service";

const REVIEWABLE_STATUSES = ["PENDING_REVIEW", "IN_REVIEW", "RESUBMITTED"];

const isUniqueViolation = (error: any) =>
  error?.code === "23505" || /duplicate key value/i.test(String(error?.message || ""));

export const RevisionService = {
  async getRevisionsForClip({ db, clipId, submittedBy, from, to, limit = 20, offset = 0, sortBy = "submittedAt", sortOrder = "desc" }: { db: any; clipId: string; submittedBy?: string; from?: string; to?: string; limit?: number; offset?: number; sortBy?: "revisionNo" | "submittedAt"; sortOrder?: "asc" | "desc" }) {
    const conditions: any[] = [eq(revisionsSchema.clipId, clipId)];
    if (submittedBy) conditions.push(eq(revisionsSchema.submittedBy, submittedBy));
    if (from) conditions.push(gte(revisionsSchema.submittedAt, new Date(`${from}T00:00:00+07:00`)));
    if (to) conditions.push(lte(revisionsSchema.submittedAt, new Date(`${to}T23:59:59+07:00`)));
    const where = and(...conditions);
    const order = sortOrder === "asc" ? asc : desc;
    const sortColumn = sortBy === "revisionNo" ? revisionsSchema.revisionNo : revisionsSchema.submittedAt;
    const [items, totals] = await Promise.all([
      db.query.revisions.findMany({
        where,
        with: {
          submittedBy: {
            columns: { id: true, displayName: true, pictureUrl: true },
          },
        },
        orderBy: [order(sortColumn), order(revisionsSchema.id)],
        limit,
        offset,
      }),
      db.select({ count: sql<number>`count(*)` }).from(revisionsSchema).where(where),
    ]);
    return { items, total: Number(totals[0]?.count || 0) };
  },

  async submitRevision({
    db,
    clipId,
    driveUrl,
    submitNote,
    userId,
    channelAccessToken,
    adminGroupId,
    executionCtx,
    pushEnv,
  }: {
    db: any;
    clipId: string;
    driveUrl?: string;
    submitNote?: string;
    userId: string;
    channelAccessToken?: string;
    adminGroupId?: string;
    executionCtx?: any;
    pushEnv?: Record<string, unknown>;
  }) {
    const extractedFileId =
      driveUrl?.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ||
      driveUrl?.match(/id=([a-zA-Z0-9_-]+)/)?.[1] ||
      `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // One atomic round trip: the revision number is computed by the database
    // (not from a prior read), the clip points at the new revision, and the
    // clip context needed for notifications is read back in the same batch.
    // uq_revisions_clip_revision_no rejects a concurrent duplicate; retry once.
    const run = () =>
      runBatch(db, (q) => [
        q
          .insert(revisionsSchema)
          .values({
            clipId,
            revisionNo: sql`(SELECT coalesce(max(${revisionsSchema.revisionNo}), 0) + 1 FROM ${revisionsSchema} WHERE ${revisionsSchema.clipId} = ${clipId})`,
            driveFileId: extractedFileId,
            driveUrl: driveUrl || "",
            submitNote: submitNote || "",
            submittedBy: userId,
          })
          .returning(),
        q
          .update(clipsSchema)
          .set({
            status: "PENDING_REVIEW",
            currentRevisionId: sql`(SELECT ${revisionsSchema.id} FROM ${revisionsSchema} WHERE ${revisionsSchema.clipId} = ${clipId} ORDER BY ${revisionsSchema.revisionNo} DESC LIMIT 1)`,
            updatedAt: new Date(),
          })
          .where(eq(clipsSchema.id, clipId)),
        q.query.clips.findFirst({
          where: (c: any, { eq }: any) => eq(c.id, clipId),
          columns: { id: true, name: true },
          with: {
            owner: { columns: { lineUserId: true, displayName: true } },
            project: { columns: { name: true } },
          },
        }),
      ]);

    let batchResult: any[];
    try {
      batchResult = await run();
    } catch (error: any) {
      if (!isUniqueViolation(error)) throw error;
      batchResult = await run();
    }
    const [[newRev], , fullClip] = batchResult as [any[], unknown, any];

    // Audit log and notifications do not affect the response: run them after it.
    const background = Promise.all([
      logActivity({
        db,
        actorId: userId,
        action: newRev.revisionNo === 1 ? "CLIP_SUBMITTED" : "CLIP_RESUBMITTED",
        entityType: "clip",
        entityId: clipId,
        meta: {
          clipName: fullClip?.name,
          revisionNo: newRev.revisionNo,
          projectName: fullClip?.project?.name,
        },
      }).catch((err) => console.error("[ACTIVITY LOG ERROR]", err)),
      fullClip
        ? NotificationService.dispatch({
            type: "PENDING_REVIEW",
            payload: {
              toLineUserId: fullClip.owner?.lineUserId,
              clipName: fullClip.name,
              projectName: fullClip.project?.name,
              editorName: fullClip.owner?.displayName || "Editor",
              driveUrl,
              submitNote,
              clipId,
              channelAccessToken,
              adminGroupId,
            },
          }, db, pushEnv)
        : Promise.resolve(),
    ]);
    if (executionCtx?.waitUntil) executionCtx.waitUntil(background);
    else background.catch(() => {});

    return newRev;
  },

  async getRevision({ db, id }: { db: any; id: string }) {
    return db.query.revisions.findFirst({
      where: (rev: any, { eq }: any) => eq(rev.id, id),
      with: {
        submittedBy: {
          columns: { id: true, displayName: true, pictureUrl: true },
        },
        clip: {
          columns: { id: true, name: true, status: true, ownerId: true },
        },
      },
    });
  },

  async getReviewsForRevision({ db, id, status, reviewerId, from, to, limit = 20, offset = 0, sortOrder = "desc" }: { db: any; id: string; status?: string[]; reviewerId?: string; from?: string; to?: string; limit?: number; offset?: number; sortOrder?: "asc" | "desc" }) {
    const revision = await db.query.revisions.findFirst({
      where: (rev: any, { eq }: any) => eq(rev.id, id),
      columns: { id: true, revisionNo: true, clipId: true },
    });

    if (!revision) {
      return null;
    }

    const conditions: any[] = [eq(reviewsSchema.revisionId, id)];
    if (status?.length) conditions.push(sql`${reviewsSchema.status} = any(${status})`);
    if (reviewerId) conditions.push(eq(reviewsSchema.reviewerId, reviewerId));
    if (from) conditions.push(gte(reviewsSchema.createdAt, new Date(`${from}T00:00:00+07:00`)));
    if (to) conditions.push(lte(reviewsSchema.createdAt, new Date(`${to}T23:59:59+07:00`)));
    const where = and(...conditions);
    const order = sortOrder === "asc" ? asc : desc;
    const [items, totals] = await Promise.all([db.query.reviews.findMany({
      where,
      with: {
        reviewer: {
          columns: { id: true, displayName: true, pictureUrl: true, role: true },
        },
      },
      orderBy: [order(reviewsSchema.createdAt), order(reviewsSchema.id)],
      limit,
      offset,
    }), db.select({ count: sql<number>`count(*)` }).from(reviewsSchema).where(where)]);
    return { items, total: Number(totals[0]?.count || 0), revision };
  },

  async submitReview({
    db,
    targetId,
    status,
    comment,
    reviewerId,
    timecodeSeconds,
    timecodeStr,
    fallbackReviewerName,
    channelAccessToken,
    executionCtx,
    pushEnv,
  }: {
    db: any;
    targetId: string;
    status: "NEEDS_REVISION" | "APPROVED";
    comment?: string;
    reviewerId: string;
    timecodeSeconds?: number;
    timecodeStr?: string;
    fallbackReviewerName: string;
    channelAccessToken?: string;
    executionCtx?: any;
    pushEnv?: Record<string, unknown>;
  }) {
    // targetId may be a revision id or (legacy callers) a clip id: resolve both
    // in parallel instead of one after the other.
    const [revision, clipById] = await Promise.all([
      db.query.revisions.findFirst({
        where: (rev: any, { eq }: any) => eq(rev.id, targetId),
        columns: { id: true, clipId: true },
        with: { clip: { columns: { id: true, status: true, ownerId: true, currentRevisionId: true } } },
      }).catch(() => null),
      db.query.clips.findFirst({
        where: (clipRow: any, { eq }: any) => eq(clipRow.id, targetId),
        columns: { id: true, status: true, ownerId: true, currentRevisionId: true },
      }).catch(() => null),
    ]);

    const currentClip = revision?.clip || clipById;
    if (!currentClip) throw new Error("Revision or Clip not found");
    if (!REVIEWABLE_STATUSES.includes(currentClip.status)) {
      throw new Error("Clip is not ready for review");
    }
    const clipId: string = currentClip.id;
    let revisionId: string | null = revision?.id || currentClip.currentRevisionId || null;

    if (!revisionId) {
      const latest = await db.query.revisions.findFirst({
        where: (rev: any, { eq }: any) => eq(rev.clipId, clipId),
        orderBy: (rev: any, { desc }: any) => [desc(rev.revisionNo)],
        columns: { id: true },
      });
      revisionId = latest?.id || null;
    }
    if (!revisionId) {
      // Legacy clip reviewed without any submission: create revision 1.
      const [[newRev]] = await runBatch(db, (q) => [
        q.insert(revisionsSchema).values({
          clipId,
          revisionNo: 1,
          driveFileId: `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          driveUrl: "",
          submitNote: "Initial submission",
          submittedBy: currentClip.ownerId,
        }).returning(),
        q.update(clipsSchema)
          .set({ currentRevisionId: sql`(SELECT ${revisionsSchema.id} FROM ${revisionsSchema} WHERE ${revisionsSchema.clipId} = ${clipId} ORDER BY ${revisionsSchema.revisionNo} DESC LIMIT 1)` })
          .where(eq(clipsSchema.id, clipId)),
      ]);
      revisionId = newRev.id;
    }

    // Review insert, status change and notification context: one round trip.
    const [[newReview], , fullClip, reviewerUser] = await runBatch(db, (q) => [
      q.insert(reviewsSchema).values({
        clipId,
        revisionId,
        reviewerId,
        status,
        comment,
        ...(timecodeSeconds !== undefined && { timecodeSeconds }),
        ...(timecodeStr && { timecodeStr }),
      }).returning(),
      q.update(clipsSchema)
        .set({ status, updatedAt: new Date() })
        .where(eq(clipsSchema.id, clipId)),
      q.query.clips.findFirst({
        where: (c: any, { eq }: any) => eq(c.id, clipId),
        columns: { id: true, name: true, ownerId: true, projectId: true },
        with: {
          owner: { columns: { lineUserId: true } },
          project: { columns: { name: true } },
        },
      }),
      q.query.users.findFirst({
        where: (u: any, { eq }: any) => eq(u.id, reviewerId),
        columns: { displayName: true },
      }),
    ]) as [any[], unknown, any, any];

    const reviewerName = reviewerUser?.displayName || fallbackReviewerName;

    const background = Promise.all([
      logActivity({
        db,
        actorId: reviewerId || null,
        action: status === "APPROVED" ? "CLIP_APPROVED" : "CLIP_REJECTED",
        entityType: "clip",
        entityId: clipId,
        meta: {
          clipName: fullClip?.name,
          projectName: fullClip?.project?.name,
          comment,
          reviewerName,
        },
      }).catch((err) => console.error("[ACTIVITY LOG ERROR]", err)),
      fullClip
        ? NotificationService.dispatch({
            type: status,
            payload: {
              // ownerId/projectId are required for the in-app notification.
              ownerId: fullClip.ownerId,
              projectId: fullClip.projectId,
              toLineUserId: fullClip.owner?.lineUserId,
              clipName: fullClip.name || "คลิปวิดีโอ",
              projectName: fullClip.project?.name,
              reviewerName,
              comment,
              clipId,
              channelAccessToken,
            },
          }, db, pushEnv)
        : Promise.resolve(),
    ]);
    if (executionCtx?.waitUntil) executionCtx.waitUntil(background);
    else background.catch(() => {});

    return newReview;
  },

  async updateReview({
    db,
    reviewId,
    comment,
    status,
  }: {
    db: any;
    reviewId: string;
    comment?: string;
    status?: "NEEDS_REVISION" | "APPROVED";
  }) {
    // simple single-update mutation, no audit log required by Phase 3 rules, so no explicit tx boundary strictly needed here, but we can just let it run.
    const updated = await db
      .update(reviewsSchema)
      .set({
        ...(comment !== undefined && { comment }),
        ...(status !== undefined && { status }),
      })
      .where(eq(reviewsSchema.id, reviewId))
      .returning();

    if (updated.length === 0) {
      return null;
    }
    return updated[0];
  },
};
