-- Guarantees one revision number per clip so concurrent submissions cannot
-- both become "revision N". The backend retries once on a conflict.
-- If legacy duplicates exist the index is skipped with a NOTICE instead of
-- failing the whole migration; renumber them and re-run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "revisions" GROUP BY "clip_id", "revision_no" HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'Skipping uq_revisions_clip_revision_no: duplicate (clip_id, revision_no) rows exist';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_revisions_clip_revision_no"
      ON "revisions" ("clip_id", "revision_no");
  END IF;
END $$;

-- Speeds up "latest revision of a clip" lookups used on submit/review.
CREATE INDEX IF NOT EXISTS "idx_revisions_clip_revision_no_desc"
  ON "revisions" ("clip_id", "revision_no" DESC);

-- Per-clip published post counts in list queries.
CREATE INDEX IF NOT EXISTS "idx_published_posts_clip_platform"
  ON "published_posts" ("clip_id", "platform");

-- Project membership checks (project_id, user_id) on every USER request.
CREATE INDEX IF NOT EXISTS "idx_user_projects_project_user"
  ON "user_projects" ("project_id", "user_id");
