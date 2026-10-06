import { sql } from "drizzle-orm";
import { sendLinePushMessage } from "./notifications/line/line.client";

/**
 * Sends a LINE alert to the ops group when the Worker fails (5xx responses,
 * cron errors). One alert per route per THROTTLE_MINUTES; repeats are counted
 * and reported with the next alert.
 *
 * The throttle lives in the system_alerts table. When the database itself is
 * failing (e.g. a missing column broke every query), it falls back to an
 * in-memory throttle so the alert still goes out.
 */

const THROTTLE_MINUTES = 10;
const memoryThrottle = new Map<string, number>();

type AlertEnv = {
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_ALERT_GROUP_ID?: string;
  LINE_ADMIN_GROUP_ID?: string;
  ENVIRONMENT?: string;
};

/** Replace ids in paths so one broken route is one alert key. */
export function normalizePath(path: string) {
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\d+(?=\/|$)/g, "/:n");
}

async function shouldSend(db: any, key: string): Promise<{ send: boolean; repeats: number }> {
  try {
    const result = await db.execute(sql`
      insert into system_alerts (alert_key, last_sent_at, suppressed, reported)
      values (${key}, now(), 0, 0)
      on conflict (alert_key) do update set
        reported = case when system_alerts.last_sent_at < now() - make_interval(mins => ${THROTTLE_MINUTES})
          then system_alerts.suppressed else system_alerts.reported end,
        suppressed = case when system_alerts.last_sent_at < now() - make_interval(mins => ${THROTTLE_MINUTES})
          then 0 else system_alerts.suppressed + 1 end,
        last_sent_at = case when system_alerts.last_sent_at < now() - make_interval(mins => ${THROTTLE_MINUTES})
          then now() else system_alerts.last_sent_at end
      returning (last_sent_at = now()) as send, reported`);
    const row = (Array.isArray(result) ? result : result?.rows ?? [])[0];
    return { send: Boolean(row?.send), repeats: Number(row?.reported || 0) };
  } catch {
    const last = memoryThrottle.get(key) || 0;
    if (Date.now() - last < THROTTLE_MINUTES * 60 * 1000) return { send: false, repeats: 0 };
    if (memoryThrottle.size > 500) memoryThrottle.clear();
    memoryThrottle.set(key, Date.now());
    return { send: true, repeats: 0 };
  }
}

export async function reportSystemError({
  db,
  env,
  source,
  status,
  message,
  requestId,
}: {
  db?: any;
  env: AlertEnv;
  /** e.g. "POST /api/clips/:id/revisions" or "cron 0 17 * * *" */
  source: string;
  status?: number;
  message?: string;
  requestId?: string;
}) {
  const groupId = env.LINE_ALERT_GROUP_ID || env.LINE_ADMIN_GROUP_ID;
  if (!groupId || !env.LINE_CHANNEL_ACCESS_TOKEN || env.ENVIRONMENT === "development") return;

  const key = `${status ?? "ERR"} ${source}`.slice(0, 200);
  const { send, repeats } = db ? await shouldSend(db, key) : { send: true, repeats: 0 };
  if (!send) return;

  const time = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date());

  const text = [
    "🚨 ClipFlow ระบบมีข้อผิดพลาด",
    `${status ? `${status} ` : ""}${source}`,
    message ? `สาเหตุ: ${message.slice(0, 300)}` : null,
    `เวลา: ${time}`,
    repeats > 0 ? `เกิดซ้ำอีก ${repeats} ครั้งใน ${THROTTLE_MINUTES} นาทีก่อนหน้า` : null,
    requestId ? `request id: ${requestId}` : null,
    `(แจ้งซ้ำได้สูงสุดทุก ${THROTTLE_MINUTES} นาทีต่อจุด)`,
  ]
    .filter(Boolean)
    .join("\n");

  await sendLinePushMessage({ toLineUserId: groupId, text, channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN }).catch(
    (err) => console.error("[SYSTEM ALERT ERROR]", err),
  );
}
