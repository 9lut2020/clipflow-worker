// ─── Core Types ────────────────────────────────────────────────────────────

export interface User {
  id: string;
  lineUserId?: string | null;
  displayName: string;
  pictureUrl: string | null;
  role: "USER" | "REVIEWER" | "ADMIN";
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  lastActiveAt?: string;
}

export interface UserProfileUpdateRequest {
  displayName: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // Optional nested (from specific endpoints)
  episodes?: Episode[];
}

export interface Episode {
  id: string;
  projectId: string;
  episodeNo: number;
  name: string | null;
  description?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  // Optional nested
  project?: Pick<Project, "id" | "name">;
  clips?: Clip[];
}

export interface Clip {
  id: string;
  name: string;
  description: string | null;
  status: ClipStatus;
  platform?: PlatformType | null;
  deadline: string | null;
  currentRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
  // Optional nested (from specific endpoints)
  project?: Pick<Project, "id" | "name">;
  episode?: Pick<Episode, "id" | "episodeNo" | "name">;
  owner?: Pick<User, "id" | "displayName" | "pictureUrl">;
  // Raw IDs (still available for filtering in list endpoints)
  episodeId?: string;
  ownerId?: string;
  driveUrl?: string | null;
}

export type PlatformType = "TIKTOK" | "YOUTUBE" | "FB_REEL" | "IG_SQUARE" | "OTHER";

export type ClipStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "IN_REVIEW"
  | "NEEDS_REVISION"
  | "APPROVED"
  | "CANCELLED";

export interface Revision {
  id: string;
  clipId: string;
  revisionNo: number;
  driveFileId: string;
  driveUrl: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  submitNote: string | null;
  submittedAt: string;
  // Nested
  submittedBy?: Pick<User, "id" | "displayName" | "pictureUrl">;
  clip?: Pick<Clip, "id" | "name" | "status">;
  reviews?: Review[];
}

export interface Review {
  id: string;
  clipId: string;
  revisionId: string;
  status: "APPROVED" | "NEEDS_REVISION";
  comment: string | null;
  timecodeSeconds?: number | null;
  timecodeStr?: string | null;
  createdAt: string;
  // Nested
  reviewer?: Pick<User, "id" | "displayName" | "pictureUrl" | "role">;
}

// ─── Context-Hoisted Response Types ────────────────────────────────────────

/** GET /projects/:id/clips — context-hoisted response */
export interface ProjectClipsResponse {
  project: Pick<Project, "id" | "name" | "description">;
  episodes: Pick<Episode, "id" | "episodeNo" | "name">[];
  clips: Clip[];
}

/** GET /episodes/:id/clips — context-hoisted response */
export interface EpisodeClipsResponse {
  episode: Pick<Episode, "id" | "episodeNo" | "name">;
  project: Pick<Project, "id" | "name">;
  clips: Clip[];
}

/** GET /clips/:id/revisions */
export interface ClipRevisionsResponse {
  clip: Pick<Clip, "id" | "name" | "status">;
  revisions: Revision[];
}

// ─── API Response Wrapper ─────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  status: "success" | "error";
  message: string;
  data: T | null;
  meta?: {
    total: number;
    page: number;
  };
}

export interface AuditLog {
  id: string;
  action: string;
  oldStatus?: string | null;
  newStatus?: string | null;
  metadata?: any;
  createdAt: string;
  user?: Pick<User, "id" | "displayName" | "pictureUrl" | "role"> | null;
  clip?: Pick<Clip, "id" | "name"> | null;
  revision?: Pick<Revision, "id" | "revisionNo"> | null;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
}
