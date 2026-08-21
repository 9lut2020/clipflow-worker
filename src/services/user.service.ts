import { eq } from "drizzle-orm";
import { createDb, users as usersSchema } from "@clipflow/db";
import { UserTransaction } from "./user-transaction";
import { logActivity } from "./activity-logger";

export class UserService {
  constructor(private db: ReturnType<typeof createDb>) {}

  async listUsers() {
    return await this.db.query.users.findMany({
      orderBy: (u: any, { desc }: any) => [desc(u.lastActiveAt)],
    });
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
    return await UserTransaction.execute(this.db, async (tx) => {
      const [updated] = await tx
        .update(usersSchema)
        .set({ role, updatedAt: new Date() })
        .where(eq(usersSchema.id, id))
        .returning();

      if (!updated) return null;

      await logActivity({
        db: tx as any,
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
    });
  }

  async updateUserStatus(
    id: string,
    isActive: boolean,
    actorId: string | null,
  ) {
    return await UserTransaction.execute(this.db, async (tx) => {
      const [updated] = await tx
        .update(usersSchema)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(usersSchema.id, id))
        .returning();

      if (!updated) return null;

      await logActivity({
        db: tx as any,
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
    });
  }

  async getUserStats(id: string) {
    const userClips = await this.db.query.clips.findMany({
      where: (clipsRow: any, { eq }: any) => eq(clipsRow.ownerId, id),
    });

    const totalClips = userClips.length;
    const approvedClips = userClips.filter(
      (clip: any) => clip.status === "APPROVED",
    ).length;
    const pendingClips = userClips.filter(
      (clip: any) => clip.status === "PENDING_REVIEW",
    ).length;
    const revisionClips = userClips.filter(
      (clip: any) => clip.status === "NEEDS_REVISION",
    ).length;

    return { totalClips, approvedClips, pendingClips, revisionClips };
  }
}
