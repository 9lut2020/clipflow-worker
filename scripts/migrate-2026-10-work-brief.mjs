// One-off migration: footage links, custom sheet columns, posters and
// per-project member roles. Additive only (nullable / defaulted columns),
// safe to run more than once. Same statements as the tail of migrate.ts.
//
//   cd backend && node scripts/migrate-2026-10-work-brief.mjs
//
// Reads DATABASE_URL from the environment, or from backend/.dev.vars.
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const url =
  process.env.DATABASE_URL ||
  fs.readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
if (!url) throw new Error("DATABASE_URL not found");
const sql = neon(url);

const statements = [
  "ALTER TABLE episodes ADD COLUMN IF NOT EXISTS source_url TEXT",
  "ALTER TABLE projects ADD COLUMN IF NOT EXISTS custom_columns JSONB DEFAULT '[]'::jsonb NOT NULL",
  "ALTER TABLE clips ADD COLUMN IF NOT EXISTS kind VARCHAR(20) DEFAULT 'CLIP' NOT NULL",
  "ALTER TABLE clips ADD COLUMN IF NOT EXISTS question TEXT",
  "ALTER TABLE clips ADD COLUMN IF NOT EXISTS source_url TEXT",
  "ALTER TABLE clips ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb NOT NULL",
  "ALTER TABLE user_projects ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'EDITOR' NOT NULL",
];

for (const statement of statements) {
  await sql(statement);
  console.log("✓", statement);
}
console.log("Done.");
