import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  createDb,
  projects as projectsSchema,
  episodes as episodesSchema,
  clips as clipsSchema,
  users as usersSchema,
  userProjects as userProjectsSchema,
} from "@clipflow/db";
import { adminOnly } from "../middleware/role";
import { NotificationService } from "../services/notifications/notification.service";
import { ProjectService } from "../services/project.service";
import { zValidator } from "@hono/zod-validator";
import {
  ProjectCreateSchema,
  ProjectUpdateSchema,
  ClipBatchCreateSchema,
} from "@clipflow/validations";
import { z } from "zod";

export const projects = new Hono<{
  Bindings: { DATABASE_URL: string };
  Variables: { db: ReturnType<typeof createDb> };
}>();

/**
 * GET /projects
 * List all active projects (lightweight — no episodes/clips)
 */
projects.get("/", async (c: any) => {
  const db = c.get("db");
  const user = c.get("user");
  const service = new ProjectService(db);

  const allProjects = await service.listProjects(user);

  return c.json({
    status: "success",
    message: "Projects retrieved successfully",
    data: allProjects,
  });
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
    const service = new ProjectService(db);

    const newProject = await service.createProject(body.name, body.description);

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

  const project = await service.getProject(id);

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
 * ADMIN — update project name/description/status
 */
projects.patch(
  "/:id",
  adminOnly,
  zValidator("json", ProjectUpdateSchema),
  async (c: any) => {
    const db = c.get("db");
    const id = c.req.param("id") as string;
    const body = c.req.valid("json");
    const service = new ProjectService(db);

    const updated = await service.updateProject(id, {
      name: body.name,
      description: body.description,
      isActive: body.isActive,
    });

    if (!updated) {
      return c.json(
        { status: "error", message: "Project not found", data: null },
        404,
      );
    }

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
  const service = new ProjectService(db);

  const updated = await service.deleteProject(id);

  if (!updated) {
    return c.json(
      { status: "error", message: "Project not found", data: null },
      404,
    );
  }

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

  const project = await service.getProjectManage(id);

  if (!project) {
    return c.json(
      { status: "error", message: "Project not found", data: null },
      404,
    );
  }

  return c.json({
    status: "success",
    message: "Project managed data retrieved successfully",
    data: project,
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
    const data = await service.getProjectClips(id, user);

    if (!data) {
      return c.json(
        { status: "error", message: "Project not found", data: null },
        404,
      );
    }

    return c.json({
      status: "success",
      message: "Project clips retrieved successfully",
      data,
    });
  } catch (error: any) {
    if (error.message.includes("Forbidden")) {
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
      const [allUsersInDb, projectObj, existingEpisodes, existingClips] =
        await Promise.all([
          db.query.users.findMany({
            columns: { id: true, lineUserId: true, displayName: true },
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
          }),
        ]);

      const validUserIdsSet = new Set<string>(
        allUsersInDb.map((u: any) => u.id),
      );
      const userMap = new Map<string, any>(
        allUsersInDb.map((u: any) => [u.id, u]),
      );
      const isValidUser = (id: any) =>
        Boolean(id && typeof id === "string" && validUserIdsSet.has(id));

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

      for (const clipData of clips) {
        // 1. Ensure episode exists (using in-memory map)
        let episode = episodeMap.get(clipData.episodeNo);
        if (!episode) {
          const [newEp] = await db
            .insert(episodesSchema)
            .values({ projectId, episodeNo: clipData.episodeNo })
            .returning();
          episode = newEp;
          episodeMap.set(clipData.episodeNo, episode);
        }

        // 2. Upsert clip & track task assignment for LINE notification
        let assignedOwnerId = "";
        let isNewlyAssigned = false;
        let clipIdForNotify = "";

        if (clipData.id && !clipData.id.toString().startsWith("new-")) {
          clipIdForNotify = clipData.id;
          const existingClip = clipMap.get(clipData.id);

          const updateData: any = {
            name: clipData.name,
            description: clipData.description || null,
            episodeId: episode.id,
            platform: clipData.platform || "TIKTOK",
            updatedAt: new Date(),
          };

          if (clipData.ownerId && isValidUser(clipData.ownerId)) {
            updateData.ownerId = clipData.ownerId;
            if (existingClip && existingClip.ownerId !== clipData.ownerId) {
              assignedOwnerId = clipData.ownerId;
              isNewlyAssigned = true;
            }
          }

          await db
            .update(clipsSchema)
            .set(updateData)
            .where(eq(clipsSchema.id, clipData.id));
        } else {
          // Create new
          const hasExplicitOwner = isValidUser(clipData.ownerId);
          const finalOwnerId = hasExplicitOwner
            ? clipData.ownerId
            : validUserId;

          const finalCreatedBy = isValidUser(clipData.createdBy)
            ? clipData.createdBy
            : validUserId;

          const [insertedClip] = await db
            .insert(clipsSchema)
            .values({
              projectId,
              episodeId: episode.id,
              name: clipData.name,
              description: clipData.description || null,
              platform: clipData.platform || "TIKTOK",
              ownerId: finalOwnerId,
              createdBy: finalCreatedBy,
              status: "DRAFT",
            })
            .returning();

          clipIdForNotify = insertedClip.id;
          assignedOwnerId = finalOwnerId;
          isNewlyAssigned = hasExplicitOwner;
        }

        // Group assigned task for batch notification
        if (isNewlyAssigned && assignedOwnerId) {
          if (!assignmentsByOwner.has(assignedOwnerId)) {
            assignmentsByOwner.set(assignedOwnerId, []);
          }
          assignmentsByOwner.get(assignedOwnerId)!.push({
            clipId: clipIdForNotify,
            clipName: clipData.name,
            projectName: projectObj?.name,
            description: clipData.description,
          });
        }
      }

      // 3. Dispatch LINE Notifications via NotificationService
      for (const [ownerId, taskList] of assignmentsByOwner.entries()) {
        const ownerUser = userMap.get(ownerId);
        if (ownerUser?.lineUserId) {
          for (const task of taskList) {
            const promise = NotificationService.dispatch(
              {
                type: "TASK_ASSIGNED",
                payload: {
                  assigneeId: ownerId,
                  clipId: task.clipId,
                  projectId: projectId,
                  toLineUserId: ownerUser.lineUserId,
                  displayName: ownerUser.displayName,
                  clipName: task.clipName,
                  projectName: task.projectName,
                  deadline: task.deadline,
                  description: task.description,
                  channelAccessToken: (c.env as any)?.LINE_CHANNEL_ACCESS_TOKEN,
                },
              },
              db,
            );
            if (c.executionCtx?.waitUntil) {
              c.executionCtx.waitUntil(promise);
            } else {
              promise.catch(() => {});
            }
          }
        }
      }

      return c.json({
        status: "success",
        message: "Clips batch updated successfully",
        data: assignmentsByOwner.size,
      });
    } catch (error) {
      console.error("Batch update error:", error);
      return c.json(
        { status: "error", message: "Failed to update clips", data: null },
        500,
      );
    }
  },
);

/**
 * GET /projects/:id/members
 * Get all members in a project
 */
projects.get("/:id/members", async (c) => {
  const db = c.get("db");
  const projectId = c.req.param("id");
  const service = new ProjectService(db);

  const usersList = await service.getProjectMembers(projectId);

  return c.json({
    status: "success",
    message: "Project members retrieved",
    data: usersList,
  });
});

/**
 * POST /projects/:id/members
 * Add a member to a project
 */
projects.post(
  "/:id/members",
  zValidator("json", z.object({ userId: z.string().uuid() })),
  async (c) => {
    const db = c.get("db");
    const projectId = c.req.param("id");
    const { userId } = c.req.valid("json");
    const service = new ProjectService(db);

    const result = await service.addProjectMember(projectId, userId);

    return c.json({
      status: "success",
      message: "User added to project",
      data: result,
    });
  },
);

/**
 * DELETE /projects/:id/members/:userId
 * Remove a member from a project
 */
projects.delete("/:id/members/:userId", async (c) => {
  const db = c.get("db");
  const projectId = c.req.param("id");
  const userId = c.req.param("userId");
  const service = new ProjectService(db);

  await service.removeProjectMember(projectId, userId);

  return c.json({
    status: "success",
    message: "User removed from project",
    data: null,
  });
});
