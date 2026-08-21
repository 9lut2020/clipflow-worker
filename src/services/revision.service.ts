import { eq } from "drizzle-orm";
import {
  clips as clipsSchema,
  revisions as revisionsSchema,
  reviews as reviewsSchema,
} from "@clipflow/db";
import { logActivity } from "./activity-logger";
import { NotificationService } from "./notifications/notification.service";

export const RevisionService = {
  async getRevisionsForClip({ db, clipId }: { db: any; clipId: string }) {
    return db.query.revisions
      .findMany({
        where: (rev: any, { eq }: any) => eq(rev.clipId, clipId),
        with: {
          submittedBy: {
            columns: { id: true, displayName: true, pictureUrl: true },
          },
          reviews: {
            with: {
              reviewer: {
                columns: {
                  id: true,
                  displayName: true,
                  pictureUrl: true,
                  role: true,
                },
              },
            },
            orderBy: (reviews: any, { desc }: any) => [desc(reviews.createdAt)],
          },
        },
        orderBy: (rev: any, { desc }: any) => [desc(rev.revisionNo)],
      })
      .catch(() => []);
  },

  async submitRevision({
    db,
    clipId,
    driveUrl,
    submitNote,
    userId,
    channelAccessToken,
    executionCtx,
  }: {
    db: any;
    clipId: string;
    driveUrl?: string;
    submitNote?: string;
    userId: string;
    channelAccessToken?: string;
    executionCtx?: any;
  }) {
    // We can do pre-reads outside the transaction to reduce lock time
    const existingRevisions = await db.query.revisions
      .findMany({
        where: (rev: any, { eq }: any) => eq(rev.clipId, clipId),
      })
      .catch(() => []);

    const nextRevisionNo = existingRevisions.length + 1;

    const extractedFileId =
      driveUrl?.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ||
      driveUrl?.match(/id=([a-zA-Z0-9_-]+)/)?.[1] ||
      `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    let notificationPayload: any = null;
    let newRevResult: any = null;

    // Database Mutation Transaction Boundary
    await db.transaction(async (tx: any) => {
      const [newRev] = await tx
        .insert(revisionsSchema)
        .values({
          clipId,
          revisionNo: nextRevisionNo,
          driveFileId: extractedFileId,
          driveUrl: driveUrl || "",
          submitNote: submitNote || "",
          submittedBy: userId,
        })
        .returning();

      newRevResult = newRev;

      // Update clip status & currentRevisionId
      await tx
        .update(clipsSchema)
        .set({
          status: "PENDING_REVIEW",
          currentRevisionId: newRev.id,
          ...(driveUrl && { driveUrl }),
          updatedAt: new Date(),
        })
        .where(eq(clipsSchema.id, clipId));

      // Need clip info for notification & audit
      const fullClip = await tx.query.clips.findFirst({
        where: (c: any, { eq }: any) => eq(c.id, clipId),
        with: { owner: true, project: true },
      });

      // Audit Log
      await logActivity({
        db: tx,
        actorId: userId,
        action: nextRevisionNo === 1 ? "CLIP_SUBMITTED" : "CLIP_RESUBMITTED",
        entityType: "clip",
        entityId: clipId,
        meta: {
          clipName: fullClip?.name,
          revisionNo: nextRevisionNo,
          projectName: fullClip?.project?.name,
        },
      });

      // Prepare notification payload if clip found
      if (fullClip) {
        notificationPayload = {
          toLineUserId: fullClip.owner?.lineUserId,
          clipName: fullClip.name,
          projectName: fullClip.project?.name,
          editorName: fullClip.owner?.displayName || "Editor",
          driveUrl,
          submitNote,
          clipId,
          channelAccessToken,
        };
      }
    });
    // <-- COMMIT

    // Post-Commit Asynchronous Notification Dispatch
    if (notificationPayload) {
      const promise = NotificationService.dispatch({
        type: "PENDING_REVIEW",
        payload: notificationPayload,
      }, db);
      if (executionCtx?.waitUntil) {
        executionCtx.waitUntil(promise);
      } else {
        // Fallback if executionCtx is not provided (e.g. testing)
        promise.catch(() => {});
      }
    }

    return newRevResult;
  },

  async getRevision({ db, id }: { db: any; id: string }) {
    return db.query.revisions.findFirst({
      where: (rev: any, { eq }: any) => eq(rev.id, id),
      with: {
        submittedBy: {
          columns: { id: true, displayName: true, pictureUrl: true },
        },
        clip: {
          columns: { id: true, name: true, status: true },
        },
        reviews: {
          with: {
            reviewer: {
              columns: { id: true, displayName: true, pictureUrl: true },
            },
          },
          orderBy: (reviews: any, { desc }: any) => [desc(reviews.createdAt)],
        },
      },
    });
  },

  async getReviewsForRevision({ db, id }: { db: any; id: string }) {
    const revision = await db.query.revisions.findFirst({
      where: (rev: any, { eq }: any) => eq(rev.id, id),
      columns: { id: true, revisionNo: true, clipId: true },
    });

    if (!revision) {
      return null;
    }

    const allReviews = await db.query.reviews.findMany({
      where: (reviews: any, { eq }: any) => eq(reviews.revisionId, id),
      with: {
        reviewer: {
          columns: { id: true, displayName: true, pictureUrl: true, role: true },
        },
      },
      orderBy: (reviews: any, { desc }: any) => [desc(reviews.createdAt)],
    });

    return allReviews;
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
  }) {
    let revisionId = targetId;
    let clipId = "";
    
    // 1. Try finding by revision ID outside transaction
    let revision = await db.query.revisions.findFirst({
      where: (rev: any, { eq }: any) => eq(rev.id, targetId),
      columns: { id: true, clipId: true, revisionNo: true },
    });

    let clip = null;

    if (revision) {
      clipId = revision.clipId;
    } else {
      // 2. Check if targetId is a clip ID
      clip = await db.query.clips.findFirst({
        where: (clipRow: any, { eq }: any) => eq(clipRow.id, targetId),
        columns: { id: true, driveUrl: true, ownerId: true },
      });

      if (!clip) {
        throw new Error("Revision or Clip not found");
      }
      clipId = clip.id;
    }

    let notificationPayload: any = null;
    let newReviewResult: any = null;

    // Database Mutation Transaction Boundary
    await db.transaction(async (tx: any) => {
      // If we didn't find a revision earlier, we might need to create one
      if (!revision) {
        const existingRevs = await tx.query.revisions.findMany({
          where: (rev: any, { eq }: any) => eq(rev.clipId, clipId),
          orderBy: (rev: any, { desc }: any) => [desc(rev.revisionNo)],
        });

        if (existingRevs.length > 0) {
          revisionId = existingRevs[0].id;
        } else if (clip) {
          // Auto-create initial Revision 1 for this clip
          const extractedFileId =
            clip.driveUrl?.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ||
            clip.driveUrl?.match(/id=([a-zA-Z0-9_-]+)/)?.[1] ||
            `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

          const [newRev] = await tx
            .insert(revisionsSchema)
            .values({
              clipId: clip.id,
              revisionNo: 1,
              driveFileId: extractedFileId,
              driveUrl: clip.driveUrl || "",
              submitNote: "Initial submission",
              submittedBy: clip.ownerId,
            })
            .returning();

          revisionId = newRev.id;

          await tx
            .update(clipsSchema)
            .set({ currentRevisionId: newRev.id })
            .where(eq(clipsSchema.id, clip.id));
        }
      }

      const [newReview] = await tx
        .insert(reviewsSchema)
        .values({
          clipId,
          revisionId,
          reviewerId,
          status,
          comment,
          ...(timecodeSeconds !== undefined && { timecodeSeconds }),
          ...(timecodeStr && { timecodeStr }),
        })
        .returning();
      
      newReviewResult = newReview;

      // Update clip status to match review outcome
      await tx
        .update(clipsSchema)
        .set({ status, updatedAt: new Date() })
        .where(eq(clipsSchema.id, clipId));

      const fullClip = await tx.query.clips.findFirst({
        where: (c: any, { eq }: any) => eq(c.id, clipId),
        with: { owner: true, project: true },
      });

      const reviewerUser = await tx.query.users.findFirst({
        where: (u: any, { eq }: any) => eq(u.id, reviewerId),
        columns: { displayName: true },
      });

      const reviewerName = reviewerUser?.displayName || fallbackReviewerName;

      // Audit Log
      await logActivity({
        db: tx,
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
      });

      if (fullClip) {
        notificationPayload = {
          toLineUserId: fullClip.owner?.lineUserId,
          clipName: fullClip?.name || "คลิปวิดีโอ",
          projectName: fullClip?.project?.name,
          reviewerName,
          comment,
          clipId,
          channelAccessToken,
        };
      }
    });
    // <-- COMMIT

    // Post-Commit Asynchronous Notification Dispatch
    if (notificationPayload) {
      const promise = NotificationService.dispatch({
        type: status,
        payload: notificationPayload,
      }, db);
      if (executionCtx?.waitUntil) {
        executionCtx.waitUntil(promise);
      } else {
        promise.catch(() => {});
      }
    }

    return newReviewResult;
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
