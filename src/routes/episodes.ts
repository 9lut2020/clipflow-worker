import { Hono } from "hono"
import { and, asc, desc, eq, ilike, sql } from "drizzle-orm"
import { createDb, episodes as episodesSchema, userProjects } from "@clipflow/db"
import { adminOnly } from "../middleware/role"
import { logActivity } from "../services/activity-logger"
import { handleApiError, paginated, parseListQuery, parseOptionalBoolean } from "../lib/api-contract"
import { ClipService } from "../services/clip.service"

export const episodes = new Hono<{
  Bindings: { DATABASE_URL: string }
  Variables: { db: ReturnType<typeof createDb> }
}>()

/**
 * GET /episodes
 * List episodes, optionally filtered by projectId
 */
episodes.get("/", async (c) => {
  try {
    const query = parseListQuery(c, { allowedSort: ["episodeNo", "name", "createdAt"] as const, defaultSort: "episodeNo", defaultLimit: 20 });
    const user = c.get("user") as any;
    const conditions: any[] = [];
    const isActive = parseOptionalBoolean(c.req.query("isActive"));
    conditions.push(eq(episodesSchema.isActive, isActive ?? true));
    if (c.req.query("projectId")) conditions.push(eq(episodesSchema.projectId, c.req.query("projectId")!));
    if (c.req.query("episodeNo")) conditions.push(eq(episodesSchema.episodeNo, Number(c.req.query("episodeNo"))));
    if (query.q) conditions.push(ilike(episodesSchema.name, `%${query.q}%`));
    if (user.role === "USER") conditions.push(sql`EXISTS (SELECT 1 FROM user_projects up WHERE up.project_id = ${episodesSchema.projectId} AND up.user_id = ${user.id})`);
    const whereClause = and(...conditions);
    const sortColumns = { episodeNo: episodesSchema.episodeNo, name: episodesSchema.name, createdAt: episodesSchema.createdAt };
    const order = query.sortOrder === "asc" ? asc : desc;
    const db = c.get("db");
    const [items, countRows] = await Promise.all([
      db.query.episodes.findMany({ where: whereClause, with: { project: { columns: { id: true, name: true } } }, orderBy: [order(sortColumns[query.sortBy]), order(episodesSchema.id)], limit: query.limit, offset: query.offset }),
      db.select({ count: sql<number>`count(*)` }).from(episodesSchema).where(whereClause),
    ]);
    return c.json({ status: "success", message: "Episodes retrieved successfully", data: paginated(items, Number(countRows[0]?.count || 0), query.page, query.limit) });
  } catch (error) { return handleApiError(c, error); }
})

/**
 * GET /episodes/:id
 * Single episode detail
 */
episodes.get("/:id", async (c) => {
  const db = c.get("db")
  const id = c.req.param("id")

  const user = c.get("user") as any;
  const episode = await db.query.episodes.findFirst({
    where: (ep, { eq, and }: any) => and(eq(ep.id, id), ...(user.role === "USER" ? [sql`EXISTS (SELECT 1 FROM user_projects up WHERE up.project_id = ${ep.projectId} AND up.user_id = ${user.id})`] : [])),
    with: {
      project: { columns: { id: true, name: true } },
    },
  })

  if (!episode) {
    return c.json({ status: "error", message: "Episode not found", data: null }, 404)
  }

  return c.json({ status: "success", message: "Episode retrieved successfully", data: episode })
})

/**
 * POST /episodes
 * ADMIN — create an episode under a project
 */
episodes.post("/", adminOnly, async (c: any) => {
  const db = c.get("db")
  const body = await c.req.json()
  const { projectId, episodeNo, name } = body
  const actorId = c.get("user")?.id || null

  if (!projectId || !episodeNo) {
    return c.json(
      { status: "error", message: "projectId and episodeNo are required", data: null },
      400
    )
  }

  const [newEpisode] = await db
    .insert(episodesSchema)
    .values({ projectId, episodeNo: Number(episodeNo), name: name || null })
    .returning()

  await logActivity({
    db,
    actorId,
    action: "EPISODE_CREATED",
    entityType: "project",
    entityId: projectId,
    meta: { episodeNo: newEpisode.episodeNo, episodeName: name || null },
  }).catch(() => {})

  return c.json({ status: "success", message: "Episode created successfully", data: newEpisode }, 201)
})

/**
 * PATCH /episodes/:id
 * ADMIN — update episode name or episodeNo
 */
episodes.patch("/:id", adminOnly, async (c: any) => {
  const db = c.get("db")
  const id = c.req.param("id") as string
  const body = await c.req.json()
  const actorId = c.get("user")?.id || null

  const updated = await db
    .update(episodesSchema)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.episodeNo !== undefined && { episodeNo: Number(body.episodeNo) }),
    })
    .where(eq(episodesSchema.id, id))
    .returning()

  if (updated.length === 0) {
    return c.json({ status: "error", message: "Episode not found", data: null }, 404)
  }

  await logActivity({
    db,
    actorId,
    action: "EPISODE_UPDATED",
    entityType: "project",
    entityId: updated[0].projectId,
    meta: { episodeNo: updated[0].episodeNo, episodeName: updated[0].name },
  }).catch(() => {})

  return c.json({ status: "success", message: "Episode updated successfully", data: updated[0] })
})

/**
 * DELETE /episodes/:id
 * ADMIN — soft delete (set isActive: false)
 */
episodes.delete("/:id", adminOnly, async (c: any) => {
  const db = c.get("db")
  const id = c.req.param("id") as string
  const actorId = c.get("user")?.id || null

  const updated = await db
    .update(episodesSchema)
    .set({ isActive: false })
    .where(eq(episodesSchema.id, id))
    .returning()

  if (updated.length === 0) {
    return c.json({ status: "error", message: "Episode not found", data: null }, 404)
  }

  await logActivity({
    db,
    actorId,
    action: "EPISODE_DELETED",
    entityType: "project",
    entityId: updated[0].projectId,
    meta: { episodeNo: updated[0].episodeNo },
  }).catch(() => {})

  return c.json({ status: "success", message: "Episode deleted successfully", data: null })
})

/**
 * GET /episodes/:id/clips
 * Clips of an episode — context-hoisted response:
 * { episode, project, clips[] } — episode/project NOT repeated per clip
 */
episodes.get("/:id/clips", async (c) => {
  try {
  const db = c.get("db")
  const episodeId = c.req.param("id") as string
  const user = c.get("user") as any
  const query = parseListQuery(c, { allowedSort: ["createdAt", "updatedAt", "deadline", "scheduledPublishAt", "name"] as const, defaultSort: "createdAt" });

  const episode = await db.query.episodes.findFirst({
    where: (ep, { eq, and }: any) => and(eq(ep.id, episodeId), ...(user.role === "USER" ? [sql`EXISTS (SELECT 1 FROM user_projects up WHERE up.project_id = ${ep.projectId} AND up.user_id = ${user.id})`] : [])),
    with: {
      project: { columns: { id: true, name: true } },
    },
  })

  if (!episode) {
    return c.json({ status: "error", message: "Episode not found", data: null }, 404)
  }

  const result = await ClipService.listClips({ db, user, episodeId, q: query.q, limit: query.limit, offset: query.offset, sortBy: query.sortBy, sortOrder: query.sortOrder, status: c.req.query("status")?.split(",") });

  return c.json({
    status: "success",
    message: "Episode clips retrieved successfully",
    data: {
      episode: { id: episode.id, episodeNo: episode.episodeNo, name: episode.name },
      project: episode.project,
      ...paginated(result.items, result.total, query.page, query.limit, { episode: { id: episode.id, episodeNo: episode.episodeNo, name: episode.name }, project: episode.project }),
    },
  })
  } catch (error) { return handleApiError(c, error); }
})
