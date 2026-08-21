import { sql } from "drizzle-orm";
import { createDb } from "@clipflow/db";

async function main() {
  const dbUrl = "postgresql://neondb_owner:npg_FDpVHg8a1cld@ep-long-shadow-azvybi45-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
  const db = createDb(dbUrl);

  console.log("Running DDL Migrations on Neon DB...");
  await db.execute(sql`ALTER TABLE clips ADD COLUMN IF NOT EXISTS platform VARCHAR(50) DEFAULT 'TIKTOK';`);
  await db.execute(sql`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS timecode_seconds INTEGER;`);
  await db.execute(sql`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS timecode_str VARCHAR(20);`);
  
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      link_url VARCHAR(500),
      is_read BOOLEAN DEFAULT FALSE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );
  `);

  console.log("🎉 NEON DB MIGRATION COMPLETE!");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
