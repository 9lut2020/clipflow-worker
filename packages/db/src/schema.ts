import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  bigint,
  pgEnum,
  jsonb,
  date,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", ["USER", "REVIEWER", "ADMIN"]);

export const clipStatusEnum = pgEnum("clip_status", [
  "DRAFT",
  "PENDING_REVIEW",
  "IN_REVIEW",
  "NEEDS_REVISION",
  "RESUBMITTED",
  "APPROVED",
  "PUBLISHED",
  "CANCELLED",
]);

export const reviewStatusEnum = pgEnum("review_status", [
  "NEEDS_REVISION",
  "APPROVED",
]);

export const activityActionEnum = pgEnum("activity_action", [
  "CLIP_SUBMITTED",
  "CLIP_RESUBMITTED",
  "CLIP_APPROVED",
  "CLIP_REJECTED",
  "TASK_ASSIGNED",
  "ROLE_CHANGED",
  "PROJECT_CREATED",
]);

export const auditActionEnum = pgEnum("audit_action", [
  "CREATE_CLIP",
  "SUBMIT_CLIP",
  "START_REVIEW",
  "REVIEW_CLIP",
  "REQUEST_REVISION",
  "RESUBMIT_CLIP",
  "APPROVE_CLIP",
  "CANCEL_CLIP",
  "UPDATE_CLIP",
  "UPDATE_PROJECT",
  "UPDATE_EPISODE",
  "ASSIGN_REVIEWER",
  "ADD_USER_PROJECT",
  "REMOVE_USER_PROJECT",
]);

export const activityLogs = pgTable("activity_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: activityActionEnum("action").notNull(),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  meta: text("meta"), // JSON string: { clipName, oldStatus, newStatus, ... }
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  clipId: uuid("clip_id").references(() => clips.id, { onDelete: "set null" }),
  revisionId: uuid("revision_id").references(() => revisions.id, { onDelete: "set null" }),
  action: auditActionEnum("action").notNull(),
  oldStatus: clipStatusEnum("old_status"),
  newStatus: clipStatusEnum("new_status"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
  return {
    userIdIdx: index("idx_audit_logs_user_id").on(table.userId),
    clipIdIdx: index("idx_audit_logs_clip_id").on(table.clipId),
    actionIdx: index("idx_audit_logs_action").on(table.action),
    createdAtIdx: index("idx_audit_logs_created_at").on(table.createdAt),
  };
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  lineUserId: varchar("line_user_id", { length: 100 }).unique(),
  displayName: varchar("display_name", { length: 100 }).notNull(),
  pictureUrl: text("picture_url"),
  role: userRoleEnum("role").default("USER").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  pictureUrl: varchar("picture_url", { length: 1024 }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const episodes = pgTable("episodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  episodeNo: integer("episode_no").notNull(),
  name: varchar("name", { length: 255 }),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const userProjects = pgTable("user_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  projectId: uuid("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const clips = pgTable("clips", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .references(() => projects.id)
    .notNull(),
  episodeId: uuid("episode_id")
    .references(() => episodes.id)
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  ownerId: uuid("owner_id")
    .references(() => users.id)
    .notNull(),
  createdBy: uuid("created_by")
    .references(() => users.id)
    .notNull(),
  status: clipStatusEnum("status").default("DRAFT").notNull(),
  platform: varchar("platform", { length: 50 }).default("TIKTOK").notNull(),
  deadline: timestamp("deadline", { withTimezone: true }),
  currentRevisionId: uuid("current_revision_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const revisions = pgTable("revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  clipId: uuid("clip_id")
    .references(() => clips.id, { onDelete: "cascade" })
    .notNull(),
  revisionNo: integer("revision_no").notNull(),
  driveFileId: varchar("drive_file_id", { length: 255 }).notNull(),
  driveUrl: text("drive_url").notNull(),
  fileName: varchar("file_name", { length: 500 }),
  mimeType: varchar("mime_type", { length: 100 }),
  fileSize: bigint("file_size", { mode: "number" }),
  submittedBy: uuid("submitted_by")
    .references(() => users.id)
    .notNull(),
  submitNote: text("submit_note"),
  submittedAt: timestamp("submitted_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  clipId: uuid("clip_id")
    .references(() => clips.id, { onDelete: "cascade" })
    .notNull(),
  revisionId: uuid("revision_id")
    .references(() => revisions.id, { onDelete: "cascade" })
    .notNull(),
  reviewerId: uuid("reviewer_id")
    .references(() => users.id)
    .notNull(),
  status: reviewStatusEnum("status").notNull(),
  comment: text("comment"),
  timecodeSeconds: integer("timecode_seconds"),
  timecodeStr: varchar("timecode_str", { length: 20 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const rawEvents = pgTable("raw_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventName: varchar("event_name", { length: 255 }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  properties: jsonb("properties"),
  context: jsonb("context"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const dailyMetrics = pgTable("daily_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: date("date").notNull(),
  metricName: varchar("metric_name", { length: 255 }).notNull(),
  dimension: varchar("dimension", { length: 255 }).notNull(),
  value: numeric("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const publishedPosts = pgTable("published_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  clipId: uuid("clip_id")
    .references(() => clips.id, { onDelete: "cascade" })
    .notNull(),
  platform: varchar("platform", { length: 50 }).notNull(),
  caption: text("caption"),
  url: text("url"),
  publishedAt: timestamp("published_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  publishedBy: uuid("published_by")
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Relations with proper Drizzle helper inference
export const usersRelations = relations(users, (helpers) => ({
  clips: helpers.many(clips),
}));

export const projectsRelations = relations(projects, (helpers) => ({
  episodes: helpers.many(episodes),
  clips: helpers.many(clips),
}));

export const episodesRelations = relations(episodes, (helpers) => ({
  project: helpers.one(projects, {
    fields: [episodes.projectId],
    references: [projects.id],
  }),
  clips: helpers.many(clips),
}));

export const clipsRelations = relations(clips, (helpers) => ({
  project: helpers.one(projects, {
    fields: [clips.projectId],
    references: [projects.id],
  }),
  episode: helpers.one(episodes, {
    fields: [clips.episodeId],
    references: [episodes.id],
  }),
  owner: helpers.one(users, {
    fields: [clips.ownerId],
    references: [users.id],
  }),
  revisions: helpers.many(revisions),
  currentRevision: helpers.one(revisions, {
    fields: [clips.currentRevisionId],
    references: [revisions.id],
  }),
  publishedPosts: helpers.many(publishedPosts),
}));

export const publishedPostsRelations = relations(publishedPosts, (helpers) => ({
  clip: helpers.one(clips, {
    fields: [publishedPosts.clipId],
    references: [clips.id],
  }),
  publishedBy: helpers.one(users, {
    fields: [publishedPosts.publishedBy],
    references: [users.id],
  }),
}));

export const revisionsRelations = relations(revisions, (helpers) => ({
  clip: helpers.one(clips, {
    fields: [revisions.clipId],
    references: [clips.id],
  }),
  submittedBy: helpers.one(users, {
    fields: [revisions.submittedBy],
    references: [users.id],
  }),
  reviews: helpers.many(reviews),
}));

export const reviewsRelations = relations(reviews, (helpers) => ({
  clip: helpers.one(clips, {
    fields: [reviews.clipId],
    references: [clips.id],
  }),
  revision: helpers.one(revisions, {
    fields: [reviews.revisionId],
    references: [revisions.id],
  }),
  reviewer: helpers.one(users, {
    fields: [reviews.reviewerId],
    references: [users.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, (helpers) => ({
  user: helpers.one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
  clip: helpers.one(clips, {
    fields: [auditLogs.clipId],
    references: [clips.id],
  }),
  revision: helpers.one(revisions, {
    fields: [auditLogs.revisionId],
    references: [revisions.id],
  }),
}));

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  linkUrl: varchar("link_url", { length: 500 }),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const notificationsRelations = relations(notifications, (helpers) => ({
  user: helpers.one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));
