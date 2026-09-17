import { Hono } from "hono";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import {
  clipPublishSchedules,
  clips,
  createDb,
  projectPublishSlots,
} from "@clipflow/db";
import { adminOnly } from "../middleware/role";

type AppDb = ReturnType<typeof createDb>;

export const publishSchedulesRouter = new Hono<{
  Bindings: { DATABASE_URL: string };
  Variables: { db: AppDb; user?: any };
}>();

function bangkokDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayOfWeek(dateString: string) {
  return new Date(`${dateString}T00:00:00Z`).getUTCDay();
}

async function getSuggestion(db: AppDb, clipId: string, startDate?: string, reservedByProject = new Map<string, Set<string>>()) {
  const clip = await db.query.clips.findFirst({
    where: (row: any, { eq }: any) => eq(row.id, clipId),
    columns: { id: true, name: true, projectId: true },
    with: { project: { columns: { id: true, name: true } } },
  });
  if (!clip) throw new Error("CLIP_NOT_FOUND");

  const slots = await db.select().from(projectPublishSlots)
    .where(and(eq(projectPublishSlots.projectId, clip.projectId), eq(projectPublishSlots.isActive, true)))
    .orderBy(asc(projectPublishSlots.dayOfWeek), asc(projectPublishSlots.publishTime));
  if (!slots.length) throw new Error("NO_PROJECT_SLOTS");

  const firstDate = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    ? startDate
    : bangkokDateString();
  const endDate = addDays(firstDate, 370);
  const occupiedRows = await db.select({ publishDate: clipPublishSchedules.publishDate })
    .from(clipPublishSchedules)
    .where(and(
      eq(clipPublishSchedules.projectId, clip.projectId),
      gte(clipPublishSchedules.publishDate, firstDate),
      lte(clipPublishSchedules.publishDate, endDate),
      eq(clipPublishSchedules.status, "SCHEDULED"),
    ));
  const occupied = new Set(occupiedRows.map((row) => row.publishDate));
  for (const date of reservedByProject.get(clip.projectId) || []) occupied.add(date);

  const now = new Date();
  for (let offset = 0; offset <= 370; offset += 1) {
    const date = addDays(firstDate, offset);
    if (occupied.has(date)) continue;
    const slot = slots.find((item) => item.dayOfWeek === dayOfWeek(date));
    if (!slot) continue;
    const scheduledAt = new Date(`${date}T${slot.publishTime}+07:00`);
    if (scheduledAt.getTime() <= now.getTime()) continue;
    return { clip, slot, publishDate: date, publishTime: slot.publishTime, scheduledAt: scheduledAt.toISOString() };
  }
  throw new Error("NO_AVAILABLE_SLOT");
}

publishSchedulesRouter.get("/slots", async (c) => {
  const projectId = c.req.query("projectId");
  const rows = await c.get("db").query.projectPublishSlots.findMany({
    where: projectId ? (row: any, { eq }: any) => eq(row.projectId, projectId) : undefined,
    with: { project: { columns: { id: true, name: true } } },
    orderBy: (row: any, { asc }: any) => [asc(row.projectId), asc(row.dayOfWeek)],
  });
  return c.json({ status: "success", data: rows });
});

publishSchedulesRouter.post("/slots", adminOnly, async (c) => {
  const body = await c.req.json();
  const projectId = String(body.projectId || "");
  const day = Number(body.dayOfWeek);
  const publishTime = String(body.publishTime || "");
  if (!projectId || !Number.isInteger(day) || day < 0 || day > 6 || !/^\d{2}:\d{2}(:\d{2})?$/.test(publishTime)) {
    return c.json({ status: "error", message: "projectId, dayOfWeek and publishTime are required" }, 400);
  }
  try {
    const [row] = await c.get("db").insert(projectPublishSlots).values({
      projectId,
      dayOfWeek: day,
      publishTime,
      createdBy: c.get("user")?.id || null,
    }).returning();
    return c.json({ status: "success", data: row }, 201);
  } catch (error: any) {
    if (error?.code === "23505") return c.json({ status: "error", message: "รายการนี้กำหนดเวลาของวันดังกล่าวไว้แล้ว" }, 409);
    throw error;
  }
});

publishSchedulesRouter.patch("/slots/:id", adminOnly, async (c) => {
  const id = c.req.param("id") as string;
  const body = await c.req.json();
  const values: any = { updatedAt: new Date() };
  if (body.dayOfWeek !== undefined) values.dayOfWeek = Number(body.dayOfWeek);
  if (body.publishTime !== undefined) values.publishTime = String(body.publishTime);
  if (body.isActive !== undefined) values.isActive = Boolean(body.isActive);
  const [row] = await c.get("db").update(projectPublishSlots).set(values)
    .where(eq(projectPublishSlots.id, id)).returning();
  return row ? c.json({ status: "success", data: row }) : c.json({ status: "error", message: "Publish slot not found" }, 404);
});

publishSchedulesRouter.delete("/slots/:id", adminOnly, async (c) => {
  const id = c.req.param("id") as string;
  const [row] = await c.get("db").delete(projectPublishSlots)
    .where(eq(projectPublishSlots.id, id)).returning();
  return row ? c.json({ status: "success", data: row }) : c.json({ status: "error", message: "Publish slot not found" }, 404);
});

publishSchedulesRouter.get("/queue", async (c) => {
  const projectId = c.req.query("projectId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const filters: any[] = [];
  if (projectId) filters.push(eq(clipPublishSchedules.projectId, projectId));
  if (from) filters.push(gte(clipPublishSchedules.publishDate, from));
  if (to) filters.push(lte(clipPublishSchedules.publishDate, to));
  const rows = await c.get("db").query.clipPublishSchedules.findMany({
    where: filters.length ? () => and(...filters) : undefined,
    with: {
      project: { columns: { id: true, name: true } },
      slot: true,
      clip: {
        with: {
          episode: { columns: { id: true, episodeNo: true, name: true } },
          owner: { columns: { id: true, displayName: true, pictureUrl: true } },
          publishedPosts: true,
          currentRevision: { columns: { id: true, driveUrl: true, revisionNo: true } },
        },
      },
    },
    orderBy: (row: any, { asc }: any) => [asc(row.publishDate), asc(row.publishTime)],
  });
  return c.json({ status: "success", data: rows });
});

publishSchedulesRouter.post("/suggest", adminOnly, async (c) => {
  const body = await c.req.json();
  try {
    const suggestion = await getSuggestion(c.get("db"), String(body.clipId || ""), body.startDate);
    return c.json({ status: "success", data: suggestion });
  } catch (error: any) {
    const messages: Record<string, string> = {
      CLIP_NOT_FOUND: "ไม่พบคลิป",
      NO_PROJECT_SLOTS: "รายการนี้ยังไม่ได้ตั้งวันและเวลาประจำ",
      NO_AVAILABLE_SLOT: "ไม่พบช่องว่างในช่วง 1 ปีถัดไป",
    };
    return c.json({ status: "error", message: messages[error.message] || "ไม่สามารถแนะนำคิวได้" }, 400);
  }
});

publishSchedulesRouter.post("/suggest-bulk", adminOnly, async (c) => {
  const body = await c.req.json();
  const clipIds = Array.isArray(body.clipIds) ? body.clipIds.map(String) : [];
  if (!clipIds.length) return c.json({ status: "error", message: "clipIds are required" }, 400);
  const reservedByProject = new Map<string, Set<string>>();
  const suggestions: any[] = [];
  const skipped: Array<{ clipId: string; reason: string }> = [];
  const messages: Record<string, string> = {
    CLIP_NOT_FOUND: "ไม่พบคลิป",
    NO_PROJECT_SLOTS: "รายการยังไม่ได้ตั้งวันและเวลาประจำ",
    NO_AVAILABLE_SLOT: "ไม่พบช่องว่างในช่วง 1 ปีถัดไป",
  };
  for (const clipId of clipIds) {
    try {
      const preview = await getSuggestion(c.get("db"), clipId, body.startDate, reservedByProject);
      if (!reservedByProject.has(preview.clip.projectId)) reservedByProject.set(preview.clip.projectId, new Set());
      reservedByProject.get(preview.clip.projectId)!.add(preview.publishDate);
      suggestions.push(preview);
    } catch (error: any) {
      skipped.push({ clipId, reason: messages[error.message] || "ไม่สามารถแนะนำคิวได้" });
    }
  }
  return c.json({ status: "success", data: { suggestions, skipped } });
});

publishSchedulesRouter.put("/queue/:clipId", adminOnly, async (c) => {
  const clipId = c.req.param("clipId") as string;
  const body = await c.req.json();
  const scheduledAt = new Date(String(body.scheduledAt || ""));
  if (Number.isNaN(scheduledAt.getTime())) return c.json({ status: "error", message: "scheduledAt is invalid" }, 400);
  const clip = await c.get("db").query.clips.findFirst({
    where: (row: any, { eq }: any) => eq(row.id, clipId),
    columns: { id: true, projectId: true, name: true },
  });
  if (!clip) return c.json({ status: "error", message: "Clip not found" }, 404);
  const publishDate = bangkokDateString(scheduledAt);
  const publishTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(scheduledAt);
  const conflict = await c.get("db").query.clipPublishSchedules.findFirst({
    where: (row: any, { and, eq, ne }: any) => and(eq(row.projectId, clip.projectId), eq(row.publishDate, publishDate), ne(row.clipId, clipId), eq(row.status, "SCHEDULED")),
    with: { clip: { columns: { id: true, name: true } } },
  });
  if (conflict && !body.allowSameDay) {
    return c.json({ status: "error", code: "SCHEDULE_CONFLICT", message: "รายการนี้มีคลิปในวันดังกล่าวแล้ว", data: { conflict } }, 409);
  }
  const result = await c.get("db").transaction(async (tx: any) => {
    const [schedule] = await tx.insert(clipPublishSchedules).values({
      projectId: clip.projectId,
      clipId,
      slotId: body.slotId || null,
      publishDate,
      publishTime,
      isRepeat: Boolean(body.allowSameDay),
      note: body.note || null,
      createdBy: c.get("user")?.id || null,
    }).onConflictDoUpdate({
      target: clipPublishSchedules.clipId,
      set: { slotId: body.slotId || null, publishDate, publishTime, isRepeat: Boolean(body.allowSameDay), note: body.note || null, status: "SCHEDULED", updatedAt: new Date() },
    }).returning();
    await tx.update(clips).set({ scheduledPublishAt: scheduledAt, updatedAt: new Date() }).where(eq(clips.id, clipId));
    return schedule;
  });
  return c.json({ status: "success", data: result });
});

publishSchedulesRouter.delete("/queue/:clipId", adminOnly, async (c) => {
  const clipId = c.req.param("clipId") as string;
  await c.get("db").transaction(async (tx: any) => {
    await tx.delete(clipPublishSchedules).where(eq(clipPublishSchedules.clipId, clipId));
    await tx.update(clips).set({ scheduledPublishAt: null, updatedAt: new Date() }).where(eq(clips.id, clipId));
  });
  return c.json({ status: "success", data: { clipId } });
});
