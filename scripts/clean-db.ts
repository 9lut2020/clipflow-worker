import { sql } from "drizzle-orm";
import { createDb } from "@clipflow/db";

async function main() {
  const dbUrl = "postgresql://neondb_owner:REDACTED@ep-long-shadow-azvybi45-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";


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
