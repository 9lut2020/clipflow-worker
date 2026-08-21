import { eq } from "drizzle-orm";

export const ClipService = {
  async listClips({
    db,
    episodeId,
    ownerId,
    status,
    excludeApproved,
  }: {
    db: any;
    episodeId?: string;
    ownerId?: string;
    status?: string;
    excludeApproved?: boolean;
  }) {
    return db.query.clips
      .findMany({
        where: (clipsRow: any, { eq, notInArray, and }: any) => {
          const conditions: any[] = [];
          if (excludeApproved) {
            conditions.push(notInArray(clipsRow.status, ["APPROVED", "CANCELLED"]));
          }
          if (episodeId) conditions.push(eq(clipsRow.episodeId, episodeId));
          if (ownerId) conditions.push(eq(clipsRow.ownerId, ownerId));
          if (status) conditions.push(eq(clipsRow.status, status));
          return conditions.length > 0 ? and(...conditions) : undefined;
        },
        columns: {
          id: true,
          name: true,
          description: true,
          status: true,
          platform: true,
          deadline: true,
          currentRevisionId: true,
          createdAt: true,
          updatedAt: true,
        },
        with: {
          owner: { columns: { id: true, displayName: true, pictureUrl: true } },
          episode: { columns: { id: true, episodeNo: true, name: true } },
          project: { columns: { id: true, name: true } },
        },
        orderBy: (clipsRow: any, { desc }: any) => [desc(clipsRow.createdAt)],
      })
      .catch(() => []);
  },

  async getClip({ db, id }: { db: any; id: string }) {
    return db.query.clips
      .findFirst({
        where: (clipsRow: any, { eq }: any) => eq(clipsRow.id, id),
        columns: {
          id: true,
          name: true,
          description: true,
          status: true,
          platform: true,
          deadline: true,
          currentRevisionId: true,
          createdAt: true,
          updatedAt: true,
        },
        with: {
          project: { columns: { id: true, name: true } },
          episode: { columns: { id: true, episodeNo: true, name: true } },
          owner: { columns: { id: true, displayName: true, pictureUrl: true } },
        },
      })
      .catch(() => null);
  },
};
