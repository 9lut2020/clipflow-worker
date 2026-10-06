import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { createDb, users as usersSchema, clips as clipsSchema } from "@clipflow/db";
import { logActivity } from "./activity-logger";

export class UserService {
  constructor(private db: ReturnType<typeof createDb>) {}

  async listUsers(query: { q?: string; role?: string; isActive?: boolean; limit: number; offset: number; sortBy: "displayName" | "lastActiveAt" | "createdAt"; sortOrder: "asc" | "desc" }) {
    const conditions: any[] = [];
    if (query.q) conditions.push(or(ilike(usersSchema.displayName, `%${query.q}%`), ilike(usersSchema.lineUserId, `%${query.q}%`)));
    if (query.role) conditions.push(eq(usersSchema.role, query.role as any));
    if (query.isActive !== undefined) conditions.push(eq(usersSchema.isActive, query.isActive));
    const whereClause = conditions.length ? and(...conditions) : undefined;
    const order = query.sortOrder === "asc" ? asc : desc;
    const sortColumns = { displayName: usersSchema.displayName, lastActiveAt: usersSchema.lastActiveAt, createdAt: usersSchema.createdAt };
    const [items, countRows] = await Promise.all([
      this.db.query.users.findMany({ where: whereClause, orderBy: [order(sortColumns[query.sortBy]), order(usersSchema.id)], limit: query.limit, offset: query.offset }),
      this.db.select({ count: sql<number>`count(*)` }).from(usersSchema).where(whereClause),
    ]);
    return { items, total: Number(countRows[0]?.count || 0) };
  }

  async getUser(id: string) {
    return await this.db.query.users.findFirst({
      where: (u: any, { eq }: any) => eq(u.id, id),
    });
  }

  async updateUserProfile(id: string, displayName: string) {
    const [updatedUser] = await this.db
      .update(usersSchema)
      .set({
        displayName,
        updatedAt: new Date(),
      })
      .where(eq(usersSchema.id, id))
      .returning();

    return updatedUser;
  }

  async syncLineUser(payload: {
    lineUserId: string;
    displayName?: string;
    pictureUrl?: string | null | undefined;
    role?: "USER" | "REVIEWER" | "ADMIN";
  }) {
    const existingUser = await this.db.query.users.findFirst({
      where: (u: any, { eq }: any) => eq(u.lineUserId, payload.lineUserId),
    });

    if (existingUser) {
      const [updated] = await this.db
        .update(usersSchema)
        .set({
          displayName: payload.displayName || existingUser.displayName,
          pictureUrl: payload.pictureUrl || existingUser.pictureUrl,
          ...(payload.role ? { role: payload.role } : {}),
          lastActiveAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(usersSchema.id, existingUser.id))
        .returning();

      return {
        user: updated || existingUser,
        isNew: false,
        oldRole: existingUser.role,
      };
    }

    const [newUser] = await this.db
      .insert(usersSchema)
      .values({
        lineUserId: payload.lineUserId,
        displayName: payload.displayName || "LINE User",
        pictureUrl: payload.pictureUrl || null,
        role: "USER",
        isActive: true,
        lastActiveAt: new Date(),
      })
      .returning();

    return { user: newUser, isNew: true, oldRole: null };
  }

  async updateUserRole(
    id: string,
    role: "USER" | "REVIEWER" | "ADMIN",
    actorId: string | null,
  ) {
    const [updated] = await this.db
      .update(usersSchema)
      .set({ role, updatedAt: new Date() })
      .where(eq(usersSchema.id, id))
      .returning();

    if (!updated) return null;

    await logActivity({
      db: this.db,
      actorId,
      action: "ROLE_CHANGED",
      entityType: "user",
      entityId: updated.id,
      meta: {
        targetName: updated.displayName,
        newRole: role,
      },
    });

    return updated;
  }

  async updateUserStatus(
    id: string,
    isActive: boolean,
    actorId: string | null,
  ) {
    const [updated] = await this.db
      .update(usersSchema)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(usersSchema.id, id))
      .returning();

    if (!updated) return null;

    await logActivity({
      db: this.db,
      actorId,
      action: "STATUS_CHANGED",
      entityType: "user",
      entityId: updated.id,
      meta: {
        targetName: updated.displayName,
        newStatus: isActive,
      },
    });

    return updated;
  }

  async getUserStats(id: string) {
    // Count in SQL instead of loading every clip the user owns.
    const rows = await this.db
      .select({ status: clipsSchema.status, count: sql<number>`count(*)::int` })
      .from(clipsSchema)
      .where(eq(clipsSchema.ownerId, id))
      .groupBy(clipsSchema.status);
    const byStatus = new Map<string, number>(rows.map((row: any) => [row.status, Number(row.count)]));
    const totalClips = Array.from(byStatus.values()).reduce((sum, value) => sum + value, 0);

    return {
      totalClips,
      approvedClips: byStatus.get("APPROVED") || 0,
      pendingClips: byStatus.get("PENDING_REVIEW") || 0,
      revisionClips: byStatus.get("NEEDS_REVISION") || 0,
    };
  }
}
