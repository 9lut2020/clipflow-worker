import { eq, and, inArray, ilike, asc, desc, sql } from "drizzle-orm";
import {
  createDb,
  projects as projectsSchema,
  episodes as episodesSchema,
  clips as clipsSchema,
  users as usersSchema,
  userProjects as userProjectsSchema,
} from "@clipflow/db";
import { User } from "@clipflow/types";
import { ClipService } from "./clip.service";

export class ProjectService {
  constructor(private db: ReturnType<typeof createDb>) {}

  /**
   * Retrieves all projects the user is authorized to see.
   * Uses a single join query for USER role instead of two sequential queries.
   */
  async listProjects(user: User, query: { q?: string; isActive?: boolean; memberId?: string; limit: number; offset: number; sortBy: "name" | "createdAt" | "updatedAt"; sortOrder: "asc" | "desc" }) {
    const conditions: any[] = [];
    if (query.isActive !== undefined) conditions.push(eq(projectsSchema.isActive, query.isActive));
    else conditions.push(eq(projectsSchema.isActive, true));
    if (query.q) conditions.push(ilike(projectsSchema.name, `%${query.q}%`));
    const order = query.sortOrder === "asc" ? asc : desc;
    const sortColumns = { name: projectsSchema.name, createdAt: projectsSchema.createdAt, updatedAt: projectsSchema.updatedAt };

    if (user.role === "USER") {
      conditions.push(eq(userProjectsSchema.userId, user.id));
      const whereClause = and(...conditions);
      const [items, countRows] = await Promise.all([this.db
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
          eq(userProjectsSchema.projectId, projectsSchema.id),
        )
        .where(whereClause)
        .orderBy(order(sortColumns[query.sortBy]), order(projectsSchema.id))
        .limit(query.limit).offset(query.offset),
        this.db.select({ count: sql<number>`count(*)` }).from(projectsSchema).innerJoin(userProjectsSchema, eq(userProjectsSchema.projectId, projectsSchema.id)).where(whereClause),
      ]);
      return { items, total: Number(countRows[0]?.count || 0) };
    }

    if (query.memberId && user.role === "ADMIN") {
      conditions.push(eq(userProjectsSchema.userId, query.memberId));
      const whereClause = and(...conditions);
      const [items, countRows] = await Promise.all([
        this.db.select({ id: projectsSchema.id, name: projectsSchema.name, description: projectsSchema.description, pictureUrl: projectsSchema.pictureUrl, isActive: projectsSchema.isActive, createdAt: projectsSchema.createdAt, updatedAt: projectsSchema.updatedAt }).from(projectsSchema).innerJoin(userProjectsSchema, eq(userProjectsSchema.projectId, projectsSchema.id)).where(whereClause).orderBy(order(sortColumns[query.sortBy]), order(projectsSchema.id)).limit(query.limit).offset(query.offset),
        this.db.select({ count: sql<number>`count(*)` }).from(projectsSchema).innerJoin(userProjectsSchema, eq(userProjectsSchema.projectId, projectsSchema.id)).where(whereClause),
      ]);
      return { items, total: Number(countRows[0]?.count || 0) };
    }

    const whereClause = and(...conditions);
    const [items, countRows] = await Promise.all([
      this.db.query.projects.findMany({ where: whereClause, orderBy: [order(sortColumns[query.sortBy]), order(projectsSchema.id)], limit: query.limit, offset: query.offset }),
      this.db.select({ count: sql<number>`count(*)` }).from(projectsSchema).where(whereClause),
    ]);
    return { items, total: Number(countRows[0]?.count || 0) };
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
  async getProject(id: string, user?: User) {
    if (user?.role === "USER") {
      const membership = await this.db.query.userProjects.findFirst({ where: and(eq(userProjectsSchema.projectId, id), eq(userProjectsSchema.userId, user.id)) });
      if (!membership) return null;
    }
    const project = await this.db.query.projects.findFirst({
      where: (p: any, { eq }: any) => eq(p.id, id),
    });
    if (!project) return null;
    const [episodeCount, clipCount] = await Promise.all([
      this.db.select({ count: sql<number>`count(*)` }).from(episodesSchema).where(and(eq(episodesSchema.projectId, id), eq(episodesSchema.isActive, true))),
      this.db.select({ count: sql<number>`count(*)` }).from(clipsSchema).where(eq(clipsSchema.projectId, id)),
    ]);
    return { ...project, _count: { episodes: Number(episodeCount[0]?.count || 0), clips: Number(clipCount[0]?.count || 0) } };
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
    return this.getProject(id);
  }

  /**
   * Get project clips with access control
   */
  async getProjectClips(id: string, user: User, query: any) {
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
    });

    if (!project) return null;

    const result = await ClipService.listClips({ db: this.db, projectId: id, user: user as any, ...query });
    return { project, ...result };
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
