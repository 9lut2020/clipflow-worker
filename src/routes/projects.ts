import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import {
  createDb,
  projects as projectsSchema,
  episodes as episodesSchema,
  clips as clipsSchema,
  users as usersSchema,
  userProjects as userProjectsSchema,
  activityLogs as activityLogsSchema,
  runBatch,
} from "@clipflow/db";
import { adminOnly } from "../middleware/role";
import { NotificationService } from "../services/notifications/notification.service";
import { ProjectService } from "../services/project.service";
import { ClipService } from "../services/clip.service";
import { logActivity } from "../services/activity-logger";
import { zValidator } from "@hono/zod-validator";
import {
  ProjectCreateSchema,
  ProjectUpdateSchema,
  ClipBatchCreateSchema,
} from "@clipflow/validations";
import { z } from "zod";
import { handleApiError, paginated, parseListQuery, parseOptionalBoolean } from "../lib/api-contract";
import { getFrontendUrl } from "../lib/frontend-url";

export const projects = new Hono<{
  Bindings: { DATABASE_URL: string };
  Variables: { db: ReturnType<typeof createDb> };
}>();

/**
 * GET /projects
 * List all active projects (lightweight — no episodes/clips)
 */
projects.get("/", async (c: any) => {
  try {
    const query = parseListQuery(c, { allowedSort: ["name", "createdAt", "updatedAt"] as const, defaultSort: "createdAt" });
    const service = new ProjectService(c.get("db"));
    const result = await service.listProjects(c.get("user"), { ...query, isActive: parseOptionalBoolean(c.req.query("isActive")), memberId: c.req.query("memberId") });
    return c.json({ status: "success", message: "Projects retrieved successfully", data: paginated(result.items, result.total, query.page, query.limit) });
  } catch (error) { return handleApiError(c, error); }
});

/**
 * POST /projects
 * ADMIN — create a new project
 */
projects.post(
  "/",
  adminOnly,
  zValidator("json", ProjectCreateSchema),
  async (c: any) => {
    const db = c.get("db");
    const body = c.req.valid("json");
    const actorId = c.get("user")?.id || null;
    const service = new ProjectService(db);

    const newProject = await service.createProject(body.name, body.description, body.pictureUrl);

    await logActivity({
      db,
      actorId,
      action: "PROJECT_CREATED",
      entityType: "project",
      entityId: newProject.id,
      meta: { projectName: newProject.name },
    }).catch(() => {});

    return c.json(
      {
        status: "success",
        message: "Project created successfully",
        data: newProject,
      },
      201,
    );
  },
);

/**
 * GET /projects/:id
 * Project detail + episodes list (no clips — use /episodes/:id/clips for that)
 */
projects.get("/:id", async (c: any) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const service = new ProjectService(db);

  const project = await service.getProject(id, c.get("user"));

  if (!project) {
    return c.json(
      { status: "error", message: "Project not found", data: null },
      404,
    );
  }

  return c.json({
    status: "success",
    message: "Project retrieved successfully",
    data: project,
  });
});

/**
 * PATCH /projects/:id
 * ADMIN — update project name/description/status/pictureUrl
 */
projects.patch(
  "/:id",
  adminOnly,
  zValidator("json", ProjectUpdateSchema),
  async (c: any) => {
    const db = c.get("db");
    const id = c.req.param("id") as string;
    const body = c.req.valid("json");
    const actorId = c.get("user")?.id || null;
    const service = new ProjectService(db);

    const updated = await service.updateProject(id, {
      name: body.name,
      description: body.description,
      pictureUrl: body.pictureUrl,
      isActive: body.isActive,
    });

    if (!updated) {
      return c.json(
        { status: "error", message: "Project not found", data: null },
        404,
      );
    }

    await logActivity({
      db,
      actorId,
      action: "PROJECT_UPDATED",
      entityType: "project",
      entityId: id,
      meta: { projectName: updated.name },
    }).catch(() => {});

    return c.json({
      status: "success",
      message: "Project updated successfully",
      data: updated,
    });
  },
);

/**
 * DELETE /projects/:id
 * ADMIN — soft delete (set isActive: false)
 */
projects.delete("/:id", adminOnly, async (c: any) => {
  const db = c.get("db");
  const id = c.req.param("id") as string;
  const actorId = c.get("user")?.id || null;
  const service = new ProjectService(db);

  const updated = await service.deleteProject(id);

  if (!updated) {
    return c.json(
      { status: "error", message: "Project not found", data: null },
      404,
    );
  }

  await logActivity({
    db,
    actorId,
    action: "PROJECT_DELETED",
    entityType: "project",
    entityId: id,
    meta: { projectName: updated.name },
  }).catch(() => {});

  return c.json({
    status: "success",
    message: "Project deleted successfully",
    data: null,
  });
});

/**
 * GET /projects/:id/manage
 * ADMIN — Full payload: project + episodes + clips + owners (for Spreadsheet page)
 */
projects.get("/:id/manage", adminOnly, async (c: any) => {
  const db = c.get("db");
  const id = c.req.param("id") as string;
  const service = new ProjectService(db);
  const user = c.get("user");

  const project = await service.getProjectManage(id);

  if (!project) {
    return c.json(
      { status: "error", message: "Project not found", data: null },
      404,
    );
  }

  const [usersResult, membersResult, episodesResult, clipsResult, videoSizesResult] = await Promise.all([
    db.query.users.findMany({
      where: (u: any, { eq }: any) => eq(u.isActive, true),
      columns: { id: true, displayName: true, pictureUrl: true, role: true, isActive: true },
      limit: 5000,
    }),
    service.getProjectMembers(id, { limit: 5000, offset: 0, sortBy: "displayName", sortOrder: "asc" }),
    db.query.episodes.findMany({ where: (ep: any, { eq }: any) => eq(ep.projectId, id), limit: 5000 }),
    ClipService.listClips({ db, projectId: id, limit: 5000, offset: 0, user }),
    db.query.videoSizes.findMany({ where: (vs: any, { eq }: any) => eq(vs.isActive, true), limit: 100 })
  ]);

  return c.json({
    status: "success",
    message: "Project managed data retrieved successfully",
    data: {
      project,
      allUsers: usersResult,
      members: membersResult.items,
      episodes: episodesResult,
      clips: clipsResult.items,
      videoSizes: videoSizesResult
    },
  });
});

/**
 * GET /projects/:id/clips
 * Context-hoisted clips for a project:
 * { project, clips[] (with owner + episode brief) }
 * Used by the Project Detail page — no revision/review data
 */
projects.get("/:id/clips", async (c: any) => {
  const db = c.get("db");
  const id = c.req.param("id") as string;
  const user = c.get("user");
  const service = new ProjectService(db);

  try {
    const query = parseListQuery(c, { allowedSort: ["createdAt", "updatedAt", "deadline", "scheduledPublishAt", "name"] as const, defaultSort: "createdAt" });
    const data = await service.getProjectClips(id, user, { limit: query.limit, offset: query.offset, sortBy: query.sortBy, sortOrder: query.sortOrder, q: query.q, episodeId: c.req.query("episodeId"), ownerId: c.req.query("ownerId"), status: c.req.query("status")?.split(",") });

    if (!data) {
      return c.json(
        { status: "error", message: "Project not found", data: null },
        404,
      );
    }

    return c.json({
      status: "success",
      message: "Project clips retrieved successfully",
      data: paginated(data.items, data.total, query.page, query.limit, { project: data.project }),
    });
  } catch (error: any) {
    if (error.message?.includes("Forbidden")) {
      return c.json(
        { status: "error", message: error.message, data: null },
        403,
      );
    }
    return c.json(
      { status: "error", message: "Internal server error", data: null },
      500,
    );
  }
});

/**
 * POST /projects/:id/episodes
 * ADMIN — Create a new episode for a project
 */
const CreateEpisodeSchema = z.object({
  episodeNo: z.number().int().positive(),
  name: z.string().optional(),
});

projects.post(
  "/:id/episodes",
  adminOnly,
  zValidator("json", CreateEpisodeSchema),
  async (c: any) => {
    const db = c.get("db");
    const projectId = c.req.param("id") as string;
    const { episodeNo, name } = c.req.valid("json");

    try {
      const { episodes } = await import("@clipflow/db");

      const [newEpisode] = await db
        .insert(episodes)
        .values({
          projectId,
          episodeNo,
          name: name || null,
        })
        .returning();

      return c.json(
        {
          status: "success",
          message: "Episode created successfully",
          data: newEpisode,
        },
        201,
      );
    } catch (error: any) {
      console.error("Failed to create episode:", error);
      // Handle unique constraint violation on project_id + episode_no (if any)
      if (error.code === "23505") {
        return c.json(
          {
            status: "error",
            message: "Episode number already exists",
            data: null,
          },
          409,
        );
      }
      return c.json(
        { status: "error", message: "Failed to create episode", data: null },
        500,
      );
    }
  },
);

/**
 * POST /projects/:id/clips/batch
 * ADMIN — Bulk create/update clips for a project (from Spreadsheet Manager)
 */
projects.post(
  "/:id/clips/batch",
  adminOnly,
  zValidator("json", ClipBatchCreateSchema),
  async (c: any) => {
    const db = c.get("db");
    const projectId = c.req.param("id") as string;
    const { clips } = c.req.valid("json");



    try {
      // 1. Pre-fetch all valid Users, Project info, existing Episodes and Clips in parallel
      const [allUsersInDb, projectObj, existingEpisodes, existingClips, memberRows] =
        await Promise.all([
          db.query.users.findMany({
            columns: { id: true, lineUserId: true, displayName: true, role: true, isActive: true },
          }),
          db.query.projects
            .findFirst({
              where: (p: any, { eq: eqOp }: any) => eqOp(p.id, projectId),
            })
            .catch(() => null),
          db.query.episodes.findMany({
            where: (ep: any, { eq: eqOp }: any) =>
              eqOp(ep.projectId, projectId),
          }),
          db.query.clips.findMany({
            where: (cRow: any, { eq: eqOp }: any) =>
              eqOp(cRow.projectId, projectId),
            columns: { id: true, ownerId: true, deadline: true },
          }),
          db.query.userProjects.findMany({
            where: (row: any, { eq: eqOp }: any) => eqOp(row.projectId, projectId),
            columns: { userId: true },
          }),
        ]);

      if (!projectObj) {
        return c.json({ status: "error", message: "Project not found", data: null }, 404);
      }

      const validUserIdsSet = new Set<string>(
        allUsersInDb.map((u: any) => u.id),
      );
      const userMap = new Map<string, any>(
        allUsersInDb.map((u: any) => [u.id, u]),
      );
      const isValidUser = (id: any) =>
        Boolean(id && typeof id === "string" && validUserIdsSet.has(id));
      const memberIds = new Set<string>(memberRows.map((m: any) => m.userId));
      // Only project members (or admins) may own clips, otherwise the assignee
      // cannot open the project they were assigned to.
      const canOwn = (id: string) => {
        const u = userMap.get(id);
        return Boolean(u && u.isActive !== false && (memberIds.has(id) || u.role === "ADMIN"));
      };
      const parseDeadline = (value: unknown) => {
        if (value === undefined) return undefined;
        if (value === null || value === "") return null;
        const date = new Date(String(value));
        return Number.isNaN(date.getTime()) ? undefined : date;
      };

      // Determine valid user ID for fallback
      const currentUserId = c.get("user")?.id;
      let validUserId = isValidUser(currentUserId)
        ? currentUserId
        : allUsersInDb[0]?.id || null;

      if (!validUserId) {
        return c.json(
          {
            status: "error",
            message: "No valid user found in system",
            data: null,
          },
          400,
        );
      }

      const episodeMap = new Map<number, any>(
        existingEpisodes.map((ep: any) => [ep.episodeNo, ep]),
      );
      const clipMap = new Map<string, any>(
        existingClips.map((cl: any) => [cl.id, cl]),
      );

      // Map to group assigned tasks per ownerId: Map<ownerId, Array<{ clipId, clipName, projectName }>>
      const assignmentsByOwner = new Map<
        string,
        {
          clipId: string;
          clipName: string;
          projectName?: string;
          deadline?: Date | null;
          description?: string | null;
        }[]
      >();

      // 1. Create every missing episode with a single INSERT.
      const missingEpisodeNos = Array.from(
        new Set<number>(clips.map((clipData: any) => clipData.episodeNo)),
      ).filter((episodeNo) => !episodeMap.has(episodeNo));
      if (missingEpisodeNos.length) {
        const insertedEpisodes = await db
          .insert(episodesSchema)
          .values(missingEpisodeNos.map((episodeNo) => ({ projectId, episodeNo })))
          .returning();
        for (const ep of insertedEpisodes) episodeMap.set(ep.episodeNo, ep);
      }

      // 2. Validate rows and build statements. All writes are sent to Neon in
      // one round trip via runBatch (which also runs as one transaction),
      // instead of one round trip per clip — the old loop exceeded the proxy
      // timeout on large projects and left assignments half-saved.
      const invalidOwners: string[] = [];
      const updateStatements: any[] = [];
      const updateResults: any[] = [];
      const newRows: any[] = [];
      const newRowMeta: any[] = [];

      for (const clipData of clips) {
        const episode = episodeMap.get(clipData.episodeNo);
        const deadline = parseDeadline((clipData as any).deadline);
        const isExisting = clipData.id && !clipData.id.toString().startsWith("new-");

        if (isExisting) {
          const existingClip = clipMap.get(clipData.id);
          // Never touch clips that belong to another project.
          if (!existingClip) continue;

          const updateData: any = {
            name: clipData.name,
            description: clipData.description || null,
            episodeId: episode.id,
            platform: clipData.platform || "TIKTOK",
            videoSizeId: clipData.videoSizeId || null,
            updatedAt: new Date(),
          };
          if (deadline !== undefined) updateData.deadline = deadline;

          let isNewlyAssigned = false;
          if (clipData.ownerId === "" || clipData.ownerId === null) {
            updateData.ownerId = null;
          } else if (clipData.ownerId && clipData.ownerId !== existingClip.ownerId) {
            if (!canOwn(clipData.ownerId)) {
              invalidOwners.push(clipData.name);
              continue;
            }
            updateData.ownerId = clipData.ownerId;
            isNewlyAssigned = true;
          }

          updateStatements.push({ id: clipData.id, data: updateData });
          updateResults.push({
            isNewlyAssigned,
            assignedOwnerId: isNewlyAssigned ? clipData.ownerId : "",
            clipIdForNotify: clipData.id,
            clipName: clipData.name,
            description: clipData.description,
            deadline: deadline ?? existingClip.deadline ?? null,
          });
        } else {
          const hasOwner = Boolean(clipData.ownerId);
          if (hasOwner && !canOwn(clipData.ownerId as string)) {
            invalidOwners.push(clipData.name);
            continue;
          }
          const finalOwnerId = hasOwner ? clipData.ownerId : null;
          newRows.push({
            projectId,
            episodeId: episode.id,
            name: clipData.name,
            description: clipData.description || null,
            platform: clipData.platform || "TIKTOK",
            videoSizeId: clipData.videoSizeId || null,
            deadline: deadline ?? null,
            ownerId: finalOwnerId,
            createdBy: isValidUser(clipData.createdBy) ? clipData.createdBy : validUserId,
            status: "DRAFT",
          });
          newRowMeta.push({
            isNewlyAssigned: Boolean(finalOwnerId),
            assignedOwnerId: finalOwnerId || "",
            clipName: clipData.name,
            description: clipData.description,
            deadline: deadline ?? null,
          });
        }
      }

      if (invalidOwners.length) {
        return c.json(
          {
            status: "error",
            message: `ผู้รับผิดชอบต้องเป็นสมาชิกของโปรเจกต์: ${invalidOwners.slice(0, 5).join(", ")}${invalidOwners.length > 5 ? " ..." : ""}`,
            data: { invalidOwners },
          },
          400,
        );
      }

      const results: any[] = [...updateResults];
      if (updateStatements.length || newRows.length) {
        const batchResults = await runBatch(db, (q) => [
          ...updateStatements.map((u) =>
            q.update(clipsSchema).set(u.data).where(eq(clipsSchema.id, u.id)),
          ),
          ...(newRows.length
            ? [q.insert(clipsSchema).values(newRows).returning({ id: clipsSchema.id })]
            : []),
        ]);
        if (newRows.length) {
          // INSERT ... VALUES ... RETURNING preserves the VALUES order.
          const insertedIds = batchResults[batchResults.length - 1] as { id: string }[];
          newRowMeta.forEach((meta, index) => {
            results.push({ ...meta, clipIdForNotify: insertedIds[index]?.id });
          });
        }
      }

      // Group assigned tasks for batch notification
      for (const res of results) {
        if (res.isNewlyAssigned && res.assignedOwnerId && res.clipIdForNotify) {
          if (!assignmentsByOwner.has(res.assignedOwnerId)) {
            assignmentsByOwner.set(res.assignedOwnerId, []);
          }
          assignmentsByOwner.get(res.assignedOwnerId)!.push({
            clipId: res.clipIdForNotify,
            clipName: res.clipName,
            projectName: projectObj?.name,
            description: res.description,
            deadline: res.deadline,
          });
        }
      }

      // 3. Dispatch notifications. In-app notifications go to every assignee;
      // LINE is skipped inside the router when the user has no lineUserId.
      const assignerName = c.get("user")?.name || "ผู้ดูแลระบบ";
      const channelAccessToken = (c.env as any)?.LINE_CHANNEL_ACCESS_TOKEN;
      const notifyPromises: Promise<void>[] = [];
      for (const [ownerId, taskList] of assignmentsByOwner.entries()) {
        const ownerUser = userMap.get(ownerId);
        const base = {
          assigneeId: ownerId,
          projectId,
          toLineUserId: ownerUser?.lineUserId || undefined,
          displayName: ownerUser?.displayName,
          assignerName,
          channelAccessToken,
        };
        notifyPromises.push(
          taskList.length === 1
            ? NotificationService.dispatch(
                { type: "TASK_ASSIGNED", payload: { ...base, ...taskList[0] } },
                db,
                c.env,
              )
            : NotificationService.dispatch(
                {
                  type: "MULTI_TASK_ASSIGNED",
                  payload: { ...base, tasks: taskList, baseUrl: getFrontendUrl(c.env) },
                },
                db,
                c.env,
              ),
        );
      }
      if (notifyPromises.length) {
        const all = Promise.all(notifyPromises).then(() => {});
        if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(all);
        else all.catch(() => {});
      }

      // Log the batch save plus one TASK_ASSIGNED entry per assigned clip, in
      // a single INSERT.
      const actorId = c.get("user")?.id || null;
      const logRows: any[] = [
        {
          actorId,
          action: "CLIP_BATCH_SAVED",
          entityType: "project",
          entityId: projectId,
          meta: JSON.stringify({ projectName: projectObj?.name, clipCount: clips.length }),
        },
      ];
      for (const [ownerId, taskList] of assignmentsByOwner.entries()) {
        for (const task of taskList) {
          logRows.push({
            actorId,
            action: "TASK_ASSIGNED",
            entityType: "clip",
            entityId: task.clipId,
            meta: JSON.stringify({
              clipName: task.clipName,
              projectName: projectObj?.name,
              targetName: userMap.get(ownerId)?.displayName,
              userId: ownerId,
            }),
          });
        }
      }
      await db.insert(activityLogsSchema).values(logRows).catch((err: any) => {
        console.error("[BATCH ACTIVITY LOG ERROR]", err);
      });

      return c.json({
        status: "success",
        message: "Clips batch updated successfully",
        data: assignmentsByOwner.size,
      });
    } catch (error: any) {
      console.error("Batch update error:", error);
      return c.json(
        { status: "error", message: "Failed to update clips", data: null },
        500,
      );
    }
  },
);

/**
 * POST /projects/:id/clips/batch-delete
 * ADMIN — delete several clips of this project in one request
 */
projects.post(
  "/:id/clips/batch-delete",
  adminOnly,
  zValidator("json", z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) })),
  async (c: any) => {
    const db = c.get("db");
    const projectId = c.req.param("id") as string;
    const { ids } = c.req.valid("json");
    try {
      const deleted = await db
        .delete(clipsSchema)
        .where(and(eq(clipsSchema.projectId, projectId), inArray(clipsSchema.id, ids)))
        .returning({ id: clipsSchema.id, name: clipsSchema.name });
      if (deleted.length) {
        await db.insert(activityLogsSchema).values(
          deleted.map((row: any) => ({
            actorId: c.get("user")?.id || null,
            action: "CLIP_DELETED",
            entityType: "clip",
            entityId: row.id,
            meta: JSON.stringify({ clipName: row.name }),
          })),
        ).catch(() => {});
      }
      return c.json({ status: "success", message: "Clips deleted", data: { deleted: deleted.length } });
    } catch (error) {
      return handleApiError(c, error);
    }
  },
);

/**
 * GET /projects/:id/members
 * ADMIN — list members in a project with pagination and filters
 */
projects.get("/:id/members", adminOnly, async (c) => {
  const db = c.get("db");
  const projectId = c.req.param("id") as string;

  try {
    const project = await db.query.projects.findFirst({
      where: (row: any, { eq: equal }: any) => equal(row.id, projectId),
      columns: { id: true },
    });
    if (!project) {
      return c.json({ status: "error", code: "NOT_FOUND", message: "Project not found", data: null, errors: {} }, 404);
    }
    const query = parseListQuery(c, {
      allowedSort: ["displayName", "lastActiveAt"] as const,
      defaultSort: "displayName",
    });
    const service = new ProjectService(db);
    const result = await service.getProjectMembers(projectId, {
      ...query,
      role: c.req.query("role"),
      isActive: parseOptionalBoolean(c.req.query("isActive")),
    });

    return c.json({
      status: "success",
      message: "Project members retrieved",
      data: paginated(result.items, result.total, query.page, query.limit),
    });
  } catch (error) {
    return handleApiError(c, error);
  }
});

/**
 * POST /projects/:id/members
 * Add a member to a project
 */
projects.post(
  "/:id/members",
  adminOnly,
  zValidator(
    "json",
    z.union([
      z.object({ userId: z.string().uuid() }),
      z.object({ userIds: z.array(z.string().uuid()).min(1).max(500) }),
    ]),
  ),
  async (c: any) => {
    const db = c.get("db");
    const projectId = c.req.param("id");
    const body = c.req.valid("json");
    const userIds: string[] = "userIds" in body ? body.userIds : [body.userId];
    const actorId = c.get("user")?.id || null;
    const service = new ProjectService(db);

    try {
      const [project, targetUsers] = await Promise.all([
        db.query.projects.findFirst({
          where: (p: any, { eq: eqFn }: any) => eqFn(p.id, projectId),
          columns: { id: true },
        }),
        db.query.users.findMany({
          where: (u: any, { inArray: inArrayFn }: any) => inArrayFn(u.id, userIds),
          columns: { id: true, displayName: true },
        }),
      ]);
      if (!project) {
        return c.json({ status: "error", message: "Project not found", data: null }, 404);
      }
      if (targetUsers.length !== new Set(userIds).size) {
        return c.json({ status: "error", message: "Some users were not found", data: null }, 400);
      }

      const inserted = await service.addProjectMembers(projectId, userIds);
      if (inserted.length) {
        const nameById = new Map(targetUsers.map((u: any) => [u.id, u.displayName]));
        await db.insert(activityLogsSchema).values(
          inserted.map((row: any) => ({
            actorId,
            action: "MEMBER_ADDED",
            entityType: "project",
            entityId: projectId,
            meta: JSON.stringify({ targetName: nameById.get(row.userId), userId: row.userId }),
          })),
        ).catch(() => {});
      }

      return c.json({
        status: "success",
        message: "Users added to project",
        data: { added: inserted.length },
      });
    } catch (error) {
      return handleApiError(c, error);
    }
  },
);

/**
 * DELETE /projects/:id/members/:userId
 * Remove a member from a project
 */
projects.delete("/:id/members/:userId", adminOnly, async (c: any) => {
  const db = c.get("db");
  const projectId = c.req.param("id");
  const userId = c.req.param("userId");
  const actorId = c.get("user")?.id || null;
  const service = new ProjectService(db);

  // Look up target user name before deleting
  const targetUser = await db.query.users.findFirst({
    where: (u: any, { eq: eqFn }: any) => eqFn(u.id, userId),
    columns: { displayName: true },
  }).catch(() => null);

  await service.removeProjectMember(projectId, userId);

  await logActivity({
    db,
    actorId,
    action: "MEMBER_REMOVED",
    entityType: "project",
    entityId: projectId,
    meta: { targetName: targetUser?.displayName, userId },
  }).catch(() => {});

  return c.json({
    status: "success",
    message: "User removed from project",
    data: null,
  });
});
