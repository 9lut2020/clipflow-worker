import { sql } from "drizzle-orm";
import { createDb } from "@clipflow/db";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is required.");
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

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      expiration_time BIGINT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
  `);
  
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS raw_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_name VARCHAR(255) NOT NULL,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      properties JSONB,
      context JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_raw_events_created_at ON raw_events(created_at DESC);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_raw_events_user_created_at ON raw_events(user_id, created_at DESC);
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS daily_metrics (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      date DATE NOT NULL,
      metric_name VARCHAR(255) NOT NULL,
      dimension VARCHAR(255) NOT NULL,
      value NUMERIC NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_metrics_date_name_dimension
      ON daily_metrics(date, metric_name, dimension);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics(date DESC);
  `);

  // New Assets and Checklists
  console.log("Adding new Enums and Tables...");
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE asset_category AS ENUM ('LOGO', 'BGM', 'FONT', 'TEMPLATE', 'OTHER');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  await db.execute(sql`ALTER TABLE clips ADD COLUMN IF NOT EXISTS checklist_data JSONB;`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS assets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      category asset_category NOT NULL,
      file_url TEXT NOT NULL,
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS checklists (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      "order" INTEGER DEFAULT 0 NOT NULL,
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );
  `);

  console.log("🎉 NEON DB MIGRATION COMPLETE!");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
