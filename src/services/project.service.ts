import { eq, and, inArray } from "drizzle-orm";
import {
  createDb,
  projects as projectsSchema,
  episodes as episodesSchema,
  clips as clipsSchema,
  users as usersSchema,
  userProjects as userProjectsSchema,
} from "@clipflow/db";
import { User } from "@clipflow/types";

export class ProjectService {
  constructor(private db: ReturnType<typeof createDb>) {}

  /**
   * Retrieves all projects the user is authorized to see.
   * Uses a single join query for USER role instead of two sequential queries.
   */
  async listProjects(user: User) {
    const conditions = [eq(projectsSchema.isActive, true)];

    if (user.role === "USER") {
      // Single join query: projects → userProjects filtered by userId
      return await this.db
        .select({
          id: projectsSchema.id,
          name: projectsSchema.name,
          description: projectsSchema.description,
          pictureUrl: projectsSchema.pictureUrl,
          isActive: projectsSchema.isActive,
          createdAt: projectsSchema.createdAt,
          updatedAt: projectsSchema.updatedAt,
        })
        .from(projectsSchema)
        .innerJoin(
          userProjectsSchema,
          and(
            eq(userProjectsSchema.projectId, projectsSchema.id),
            eq(userProjectsSchema.userId, user.id),
          ),
        )
        .where(eq(projectsSchema.isActive, true))
        .orderBy((projectsSchema as any).createdAt);
    }

    // ADMIN / REVIEWER: fetch all active projects
    return await this.db.query.projects.findMany({
      where: and(...conditions),
      orderBy: (p: any, { desc }: any) => [desc(p.createdAt)],
    });
  }

  /**
   * Create a new project
   */
  async createProject(name: string, description: string | null = null, pictureUrl: string | null = null) {
    const [newProject] = await this.db
      .insert(projectsSchema)
      .values({ name, description, pictureUrl })
      .returning();
    return newProject;
  }

  /**
   * Get project detail
   */
  async getProject(id: string) {
    return await this.db.query.projects.findFirst({
      where: (p: any, { eq }: any) => eq(p.id, id),
      with: {
        episodes: {
          where: (ep: any, { eq }: any) => eq(ep.isActive, true),
          orderBy: (ep: any, { asc }: any) => [asc(ep.episodeNo)],
        },
      },
    });
  }

  /**
   * Update project
   */
  async updateProject(
    id: string,
    updates: { name?: string; description?: string | null; pictureUrl?: string | null; isActive?: boolean }
  ) {
    const updated = await this.db
      .update(projectsSchema)
      .set(updates)
      .where(eq(projectsSchema.id, id))
      .returning();
    return updated[0] || null;
  }

  /**
   * Soft delete project
   */
  async deleteProject(id: string) {
    return await this.updateProject(id, { isActive: false });
  }

  /**
   * Get project manage detail
   */
  async getProjectManage(id: string) {
    return await this.db.query.projects.findFirst({
      where: (p: any, { eq }: any) => eq(p.id, id),
      with: {
        episodes: {
          where: (ep: any, { eq }: any) => eq(ep.isActive, true),
          with: {
            clips: {
              with: {
                owner: {
                  columns: { id: true, displayName: true, pictureUrl: true },
                },
              },
            },
          },
          orderBy: (ep: any, { asc }: any) => [asc(ep.episodeNo)],
        },
      },
    });
  }

  /**
   * Get project clips with access control
   */
  async getProjectClips(id: string, user: User) {
    if (user.role === "USER") {
      const membership = await this.db.query.userProjects.findFirst({
        where: and(
          eq(userProjectsSchema.projectId, id),
          eq(userProjectsSchema.userId, user.id)
        )
      });
      if (!membership) {
        throw new Error("Forbidden: You are not assigned to this project");
      }
    }

    const project = await this.db.query.projects.findFirst({
      where: (p: any, { eq }: any) => eq(p.id, id),
      columns: { id: true, name: true, description: true },
      with: {
        episodes: {
          orderBy: (ep: any, { asc }: any) => [asc(ep.episodeNo)],
          columns: { id: true, episodeNo: true, name: true },
        },
      },
    });

    if (!project) return null;

    const clips = await this.db.query.clips.findMany({
      where: (clips: any, { eq }: any) => eq(clips.projectId, id),
      columns: {
        id: true, name: true, description: true, status: true, platform: true,
        episodeId: true, ownerId: true, deadline: true, currentRevisionId: true,
        createdAt: true, updatedAt: true,
      },
      with: {
        owner: { columns: { id: true, displayName: true, pictureUrl: true } },
        episode: { columns: { id: true, episodeNo: true, name: true } },
      },
      orderBy: (clips: any, { asc }: any) => [asc(clips.createdAt)],
    });

    return { project, clips };
  }

  /**
   * Members management
   */
  async getProjectMembers(projectId: string) {
    const projectMembers = await this.db.query.userProjects.findMany({
      where: eq(userProjectsSchema.projectId, projectId),
    });
    const memberIds = projectMembers.map((m) => m.userId);
    if (memberIds.length === 0) return [];

    return await this.db.query.users.findMany({
      where: inArray(usersSchema.id, memberIds),
      columns: { id: true, displayName: true, pictureUrl: true, role: true },
    });
  }

  async addProjectMember(projectId: string, userId: string) {
    const existing = await this.db.query.userProjects.findFirst({
      where: and(
        eq(userProjectsSchema.projectId, projectId),
        eq(userProjectsSchema.userId, userId),
      ),
    });
    if (existing) return existing;

    const [inserted] = await this.db
      .insert(userProjectsSchema)
      .values({ projectId, userId })
      .returning();
    return inserted;
  }

  async removeProjectMember(projectId: string, userId: string) {
    await this.db
      .delete(userProjectsSchema)
      .where(
        and(
          eq(userProjectsSchema.projectId, projectId),
          eq(userProjectsSchema.userId, userId),
        ),
      );
  }
}
