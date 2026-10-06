import { sql } from "drizzle-orm";
import { createDb } from "@clipflow/db";

async function main() {
  // Never hardcode a connection string here: this script wipes every table.
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("Set DATABASE_URL (point it at a Neon branch, not production).");
  if (!process.argv.includes("--yes-delete-all-data")) {
    throw new Error("This deletes ALL application data. Re-run with --yes-delete-all-data to confirm.");
  }

  console.log("Connecting to DB...");
  const db = createDb(dbUrl);

  console.log("🧹 Truncating all data...");

  // Order matters due to foreign key constraints, or we can use CASCADE
  await db.execute(sql`
    TRUNCATE TABLE 
      audit_logs,
      raw_events,
      daily_metrics,
      notifications,
      push_subscriptions,
      reviews,
      revisions,
      published_posts,
      clip_publish_schedules,
      clips,
      episodes,
      project_publish_slots,
      projects
    CASCADE;
  `);

  console.log("✅ All application data has been cleared!");
  process.exit(0);
}

main().catch(console.error);
