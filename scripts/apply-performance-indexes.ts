import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

// Idempotent migrations (IF NOT EXISTS only), safe to re-run at any time.
const MIGRATIONS = [
  "packages/db/migrations/0012_safe_performance_indexes.sql",
  "packages/db/migrations/0013_revision_no_unique.sql",
];

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const varsPath = path.resolve(".dev.vars");
  if (!fs.existsSync(varsPath)) return "";
  return fs.readFileSync(varsPath, "utf8").match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim() || "";
}

// Splits on ";" at statement boundaries, keeping DO $$ ... $$ blocks intact.
function splitStatements(source: string) {
  const withoutComments = source.replace(/--[^\n]*/g, "");
  const statements: string[] = [];
  let current = "";
  let inDollarBlock = false;
  for (let i = 0; i < withoutComments.length; i += 1) {
    if (withoutComments.startsWith("$$", i)) {
      inDollarBlock = !inDollarBlock;
      current += "$$";
      i += 1;
      continue;
    }
    const char = withoutComments[i];
    if (char === ";" && !inDollarBlock) {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function main() {
  const statements = MIGRATIONS.flatMap((file) => {
    const migrationPath = path.resolve(file);
    if (!fs.existsSync(migrationPath)) {
      console.warn(`Missing ${file}; skipping.`);
      return [];
    }
    return splitStatements(fs.readFileSync(migrationPath, "utf8"));
  });

  if (process.argv.includes("--dry-run")) {
    console.log(`Validated ${statements.length} idempotent index statements.`);
    return;
  }

  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is required to apply database indexes.");

  const sql = neon(url);
  for (const statement of statements) await sql(statement);
  console.log(`Applied ${statements.length} idempotent performance index statements.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
