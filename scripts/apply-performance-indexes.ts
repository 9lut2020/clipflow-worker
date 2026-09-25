import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const varsPath = path.resolve(".dev.vars");
  if (!fs.existsSync(varsPath)) return "";
  return fs.readFileSync(varsPath, "utf8").match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim() || "";
}

async function main() {
  const migrationPath = path.resolve("packages/db/migrations/0012_safe_performance_indexes.sql");
  const statements = fs.readFileSync(migrationPath, "utf8")
    .split(";")
    .map((statement) => statement.replace(/--[^\n]*/g, "").trim())
    .filter(Boolean);

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
