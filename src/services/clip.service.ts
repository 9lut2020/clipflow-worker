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
    hydrationDb,
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
    sortBy?: "createdAt" | "updatedAt" | "deadline" | "scheduledPublishAt" | "name" | "project";
    sortOrder?: "asc" | "desc";
    user?: { id: string; role: "USER" | "REVIEWER" | "ADMIN" };
    hydrationDb?: any;
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
      project: sql`(select p.name from projects p where p.id = ${clipsSchema.projectId})`,
    };
    const order = sortOrder === "asc" ? asc : desc;

    // Select stable IDs first, then hydrate each page row with the same
    // primary-key query used by the detail endpoint. In the Worker runtime,
    // Drizzle's relational findMany could return a stale snapshot immediately
    // after a mutation even though PostgreSQL had committed the change.
    const [pageRows, countRows] = await Promise.all([
      db
        .select({ id: clipsSchema.id })
        .from(clipsSchema)
        .where(whereClause)
        .orderBy(order(sortColumns[sortBy]), order(clipsSchema.id))
        .limit(limit ?? 20)
        .offset(offset ?? 0),
      db.select({ count: sql<number>`count(*)` }).from(clipsSchema).where(whereClause),
    ]);
    // Use a separate client for the relation hydration. The Worker/Hyperdrive
    // client used for pagination can otherwise hold an older read snapshot
    // immediately after a successful mutation.
    const readDb = hydrationDb || db;
    const items = await Promise.all(
      pageRows.map(async ({ id }: { id: string }) => {
        // Use the exact read shape that powers GET /clips/:id. This avoids
        // divergence between the detail and paginated list consistency paths.
        return ClipService.getClip({ db: readDb, id, user });
      }),
    );

    return { items: items.filter(Boolean), total: Number(countRows[0]?.count || 0) };
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
