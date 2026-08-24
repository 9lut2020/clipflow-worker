import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { createDb, episodes as episodesSchema } from "@clipflow/db"
import { adminOnly } from "../middleware/role"
import { logActivity } from "../services/activity-logger"

export const episodes = new Hono<{
  Bindings: { DATABASE_URL: string }
  Variables: { db: ReturnType<typeof createDb> }
}>()

/**
 * GET /episodes
 * List episodes, optionally filtered by projectId
 */
episodes.get("/", async (c) => {
  const db = c.get("db")
  const projectId = c.req.query("projectId")

  const allEpisodes = await db.query.episodes.findMany({
    where: (ep, { eq, and }) => {
      const conditions = [eq(ep.isActive, true)]
      if (projectId) conditions.push(eq(ep.projectId, projectId))
      return and(...conditions)
    },
    orderBy: (ep, { asc }) => [asc(ep.episodeNo)],
  })

  return c.json({ status: "success", message: "Episodes retrieved successfully", data: allEpisodes })
})

/**
 * GET /episodes/:id
 * Single episode detail
 */
episodes.get("/:id", async (c) => {
  const db = c.get("db")
  const id = c.req.param("id")

  const episode = await db.query.episodes.findFirst({
    where: (ep, { eq }) => eq(ep.id, id),
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
  const db = c.get("db")
  const episodeId = c.req.param("id")

  const episode = await db.query.episodes.findFirst({
    where: (ep, { eq }) => eq(ep.id, episodeId),
    with: {
      project: { columns: { id: true, name: true } },
    },
  })

  if (!episode) {
    return c.json({ status: "error", message: "Episode not found", data: null }, 404)
  }

  const clips = await db.query.clips.findMany({
    where: (clips, { eq }) => eq(clips.episodeId, episodeId),
    columns: {
      id: true,
      name: true,
      description: true,
      status: true,
      deadline: true,
      currentRevisionId: true,
      createdAt: true,
      updatedAt: true,
    },
    with: {
      owner: { columns: { id: true, displayName: true, pictureUrl: true } },
    },
    orderBy: (clips, { asc }) => [asc(clips.createdAt)],
  })

  return c.json({
    status: "success",
    message: "Episode clips retrieved successfully",
    data: {
      episode: { id: episode.id, episodeNo: episode.episodeNo, name: episode.name },
      project: episode.project,
      clips,
    },
  })
})
