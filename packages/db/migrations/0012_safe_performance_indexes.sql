-- Safe, repeatable indexes for the backend-filtered task and publish lists.
-- This migration intentionally contains no data mutation.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "idx_clips_owner_status_created"
  ON "clips" ("owner_id", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_clips_project_status_created"
  ON "clips" ("project_id", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_clips_scheduled_publish_at"
  ON "clips" ("scheduled_publish_at");
CREATE INDEX IF NOT EXISTS "idx_clips_project_status_scheduled"
  ON "clips" ("project_id", "status", "scheduled_publish_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_clips_name_trgm"
  ON "clips" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_clips_description_trgm"
  ON "clips" USING gin ("description" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "idx_episodes_project_active_no"
  ON "episodes" ("project_id", "is_active", "episode_no");
CREATE INDEX IF NOT EXISTS "idx_users_role_active_last_active"
  ON "users" ("role", "is_active", "last_active_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_notifications_user_read_created"
  ON "notifications" ("user_id", "is_read", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_revisions_clip_submitted"
  ON "revisions" ("clip_id", "submitted_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_reviews_revision_created"
  ON "reviews" ("revision_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_publish_schedules_date_status"
  ON "clip_publish_schedules" ("publish_date", "status");
CREATE INDEX IF NOT EXISTS "idx_publish_schedules_project_date_status"
  ON "clip_publish_schedules" ("project_id", "publish_date", "status");
CREATE INDEX IF NOT EXISTS "idx_publish_slots_project_active_day"
  ON "project_publish_slots" ("project_id", "is_active", "day_of_week");
