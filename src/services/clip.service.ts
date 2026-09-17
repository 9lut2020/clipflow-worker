import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { clips as clipsSchema } from "@clipflow/db";

export const ClipService = {
  async listClips({
    db,
    episodeId,
    ownerId,
    status,
    excludeApproved,
    limit,
    offset,
    projectId,
    videoSizeId,
    q,
    scheduledState,
    postingState,
    scheduledFrom,
    scheduledTo,
    deadlineFrom,
    deadlineTo,
    createdFrom,
    createdTo,
    sortBy = "createdAt",
    sortOrder = "desc",
    user,
  }: {
    db: any;
    episodeId?: string;
    ownerId?: string;
    status?: string | string[];
    excludeApproved?: boolean;
    limit?: number;
    offset?: number;
    projectId?: string;
    videoSizeId?: string;
    q?: string;
    scheduledState?: "scheduled" | "unscheduled" | "overdue";
    postingState?: "unposted" | "partial" | "completed";
    scheduledFrom?: string;
    scheduledTo?: string;
    deadlineFrom?: string;
    deadlineTo?: string;
    createdFrom?: string;
    createdTo?: string;
    sortBy?: "createdAt" | "updatedAt" | "deadline" | "scheduledPublishAt" | "name";
    sortOrder?: "asc" | "desc";
    user?: { id: string; role: "USER" | "REVIEWER" | "ADMIN" };
  }) {
    const conditions: any[] = [];
    if (excludeApproved) conditions.push(notInArray(clipsSchema.status, ["APPROVED", "PUBLISHED", "CANCELLED"]));
    if (episodeId) conditions.push(eq(clipsSchema.episodeId, episodeId));
    if (projectId) conditions.push(eq(clipsSchema.projectId, projectId));
    if (videoSizeId) conditions.push(eq(clipsSchema.videoSizeId, videoSizeId));
    if (ownerId) conditions.push(eq(clipsSchema.ownerId, ownerId));
    if (status) conditions.push(Array.isArray(status) ? inArray(clipsSchema.status, status as any) : eq(clipsSchema.status, status as any));
    if (q) conditions.push(or(ilike(clipsSchema.name, `%${q}%`), ilike(clipsSchema.description, `%${q}%`)));
    if (scheduledState === "scheduled") conditions.push(isNotNull(clipsSchema.scheduledPublishAt));
    if (scheduledState === "unscheduled") conditions.push(isNull(clipsSchema.scheduledPublishAt));
    if (scheduledState === "overdue") conditions.push(and(isNotNull(clipsSchema.scheduledPublishAt), lte(clipsSchema.scheduledPublishAt, new Date())));
    if (scheduledFrom) conditions.push(gte(clipsSchema.scheduledPublishAt, new Date(`${scheduledFrom}T00:00:00+07:00`)));
    if (scheduledTo) conditions.push(lte(clipsSchema.scheduledPublishAt, new Date(`${scheduledTo}T23:59:59+07:00`)));
    if (deadlineFrom) conditions.push(gte(clipsSchema.deadline, new Date(`${deadlineFrom}T00:00:00+07:00`)));
    if (deadlineTo) conditions.push(lte(clipsSchema.deadline, new Date(`${deadlineTo}T23:59:59+07:00`)));
    if (createdFrom) conditions.push(gte(clipsSchema.createdAt, new Date(`${createdFrom}T00:00:00+07:00`)));
    if (createdTo) conditions.push(lte(clipsSchema.createdAt, new Date(`${createdTo}T23:59:59+07:00`)));
    if (postingState === "unposted") conditions.push(sql`(SELECT count(*) FROM published_posts pp WHERE pp.clip_id = ${clipsSchema.id}) = 0`);
    if (postingState === "partial") conditions.push(sql`(SELECT count(DISTINCT pp.platform) FROM published_posts pp WHERE pp.clip_id = ${clipsSchema.id}) BETWEEN 1 AND 3`);
    if (postingState === "completed") conditions.push(sql`(SELECT count(DISTINCT pp.platform) FROM published_posts pp WHERE pp.clip_id = ${clipsSchema.id}) >= 4`);
    if (user?.role === "USER") conditions.push(eq(clipsSchema.ownerId, user.id));
    if (user?.role === "REVIEWER") conditions.push(notInArray(clipsSchema.status, ["DRAFT", "CANCELLED"]));

    const whereClause = conditions.length ? and(...conditions) : undefined;
    const sortColumns: Record<string, any> = {
      createdAt: clipsSchema.createdAt,
      updatedAt: clipsSchema.updatedAt,
      deadline: clipsSchema.deadline,
      scheduledPublishAt: clipsSchema.scheduledPublishAt,
      name: clipsSchema.name,
    };
    const order = sortOrder === "asc" ? asc : desc;

    const [items, countRows] = await Promise.all([
      db.query.clips.findMany({
        where: whereClause,
        columns: {
          id: true,
          name: true,
          description: true,
          status: true,
          platform: true,
          videoSizeId: true,
          deadline: true,
          scheduledPublishAt: true,
          driveUrl: true,
          currentRevisionId: true,
          createdAt: true,
          updatedAt: true,
        },
        with: {
          owner: { columns: { id: true, displayName: true, pictureUrl: true } },
          episode: { columns: { id: true, episodeNo: true, name: true } },
          project: { columns: { id: true, name: true } },
          videoSize: { columns: { id: true, name: true, width: true, height: true } },
          publishedPosts: true,
          currentRevision: {
            columns: { id: true, driveUrl: true, revisionNo: true },
            with: {
              reviews: {
                columns: { id: true, status: true, comment: true, createdAt: true },
                with: {
                  reviewer: { columns: { id: true, displayName: true, pictureUrl: true } },
                },
                orderBy: (r: any, { desc }: any) => [desc(r.createdAt)],
                limit: 1,
              },
            },
          },
          publishSchedule: {
            columns: {
              id: true,
              slotId: true,
              publishDate: true,
              publishTime: true,
              status: true,
              isRepeat: true,
              note: true,
            },
          },
        },
        limit: limit ?? 20,
        offset: offset ?? 0,
        orderBy: [order(sortColumns[sortBy]), order(clipsSchema.id)],
      }),
      db.select({ count: sql<number>`count(*)` }).from(clipsSchema).where(whereClause),
    ]);
    return { items, total: Number(countRows[0]?.count || 0) };
  },

  async getClip({ db, id, user }: { db: any; id: string; user?: { id: string; role: string } }) {
    return db.query.clips
      .findFirst({
        where: (clipsRow: any, { eq, and, notInArray }: any) => {
          const conditions = [eq(clipsRow.id, id)];
          if (user?.role === "USER") conditions.push(eq(clipsRow.ownerId, user.id));
          if (user?.role === "REVIEWER") conditions.push(notInArray(clipsRow.status, ["DRAFT", "CANCELLED"]));
          return and(...conditions);
        },
        columns: {
          id: true,
          name: true,
          description: true,
          status: true,
          platform: true,
          videoSizeId: true,
          deadline: true,
          scheduledPublishAt: true,
          currentRevisionId: true,
          createdAt: true,
          updatedAt: true,
        },
        with: {
          project: { columns: { id: true, name: true } },
          episode: { columns: { id: true, episodeNo: true, name: true } },
          owner: { columns: { id: true, displayName: true, pictureUrl: true } },
          videoSize: { columns: { id: true, name: true, width: true, height: true } },
          publishSchedule: true,
        },
      })
      .catch(() => null);
  },
};
