import { sql } from "drizzle-orm";
import { createDb } from "@clipflow/db";
import type { Env } from "../index";

export async function aggregateDailyMetrics(env: Env) {
  console.log("[CRON] Starting daily metrics aggregation");
  const db = createDb(env.DATABASE_URL);

  try {
    // 1. DAU (Daily Active Users)
    await db.execute(sql`
      INSERT INTO daily_metrics (date, metric_name, dimension, value)
      SELECT 
        DATE(created_at) as date,
        'dau' as metric_name,
        'global' as dimension,
        COUNT(DISTINCT user_id) as value
      FROM raw_events
      WHERE created_at >= NOW() - INTERVAL '1 day'
      GROUP BY DATE(created_at)
      ON CONFLICT (date, metric_name, dimension) 
      DO UPDATE SET value = EXCLUDED.value, created_at = NOW();
    `);

    // 2. Events Count
    await db.execute(sql`
      INSERT INTO daily_metrics (date, metric_name, dimension, value)
      SELECT 
        DATE(created_at) as date,
        event_name as metric_name,
        'event_count' as dimension,
        COUNT(*) as value
      FROM raw_events
      WHERE created_at >= NOW() - INTERVAL '1 day'
      GROUP BY DATE(created_at), event_name
      ON CONFLICT (date, metric_name, dimension) 
      DO UPDATE SET value = EXCLUDED.value, created_at = NOW();
    `);
    
    console.log("[CRON] Daily metrics aggregation completed");
  } catch (error) {
    console.error("[CRON] Failed to aggregate metrics:", error);
  }
}
