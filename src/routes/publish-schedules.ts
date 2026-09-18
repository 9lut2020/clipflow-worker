import { Hono } from "hono";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import {
  clipPublishSchedules,
  clips,
  createDb,
  projectPublishSlots,
  projects,
} from "@clipflow/db";
import { adminOnly } from "../middleware/role";
import { handleApiError, paginated, parseListQuery, parseMultiValue, parseOptionalBoolean } from "../lib/api-contract";
import { ClipService } from "../services/clip.service";

type AppDb = ReturnType<typeof createDb>;

export const publishSchedulesRouter = new Hono<{
  Bindings: { DATABASE_URL: string };
  Variables: { db: AppDb; user?: any };
}>();

publishSchedulesRouter.use("*", adminOnly);

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

publishSchedulesRouter.get("/summary", async (c) => {
  const db = c.get("db");
  const [row] = await db.select({
    unscheduled: sql<number>`count(*) filter (where ${clips.scheduledPublishAt} is null)`,
    scheduled: sql<number>`count(*) filter (where ${clips.scheduledPublishAt} is not null)`,
    overdue: sql<number>`count(*) filter (where ${clips.scheduledPublishAt} < now() and (select count(*) from published_posts pp where pp.clip_id = ${clips.id}) = 0)`,
    partial: sql<number>`count(*) filter (where (select count(distinct pp.platform) from published_posts pp where pp.clip_id = ${clips.id}) between 1 and 3)`,
    completed: sql<number>`count(*) filter (where (select count(distinct pp.platform) from published_posts pp where pp.clip_id = ${clips.id}) >= 4)`,
  }).from(clips).where(inArray(clips.status, ["APPROVED", "PUBLISHED"]));
  return c.json({ status: "success", message: "Publish summary retrieved successfully", data: Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])) });
});

publishSchedulesRouter.get("/items", async (c) => {
  try {
    const query = parseListQuery(c, { allowedSort: ["scheduledAt", "createdAt", "name", "project"] as const, defaultSort: "scheduledAt" });
    const scheduleState = c.req.query("scheduleState");
    const postingState = c.req.query("postingState");
    const result = await ClipService.listClips({
      db: c.get("db"), q: query.q, projectId: c.req.query("projectId"), ownerId: c.req.query("ownerId"), status: ["APPROVED", "PUBLISHED"],
      scheduledState: scheduleState === "scheduled" || scheduleState === "unscheduled" || scheduleState === "overdue" ? scheduleState : undefined,
      postingState: postingState === "unposted" || postingState === "partial" || postingState === "completed" ? postingState : undefined,
      scheduledFrom: c.req.query("from"), scheduledTo: c.req.query("to"), limit: query.limit, offset: query.offset,
      sortBy: query.sortBy === "scheduledAt" ? "scheduledPublishAt" : query.sortBy, sortOrder: query.sortOrder,
    });
    return c.json({ status: "success", message: "Publish items retrieved successfully", data: paginated(result.items, result.total, query.page, query.limit) });
  } catch (error) { return handleApiError(c, error); }
});

publishSchedulesRouter.get("/slots", async (c) => {
  try {
    const query = parseListQuery(c, { allowedSort: ["project", "dayOfWeek", "publishTime"] as const, defaultSort: "project" });
    const filters: any[] = [];
    if (query.q) filters.push(ilike(projects.name, `%${query.q}%`));
    if (c.req.query("projectId")) filters.push(eq(projectPublishSlots.projectId, c.req.query("projectId")!));
    if (c.req.query("dayOfWeek") !== undefined) filters.push(eq(projectPublishSlots.dayOfWeek, Number(c.req.query("dayOfWeek"))));
    const active = parseOptionalBoolean(c.req.query("isActive"));
    if (active !== undefined) filters.push(eq(projectPublishSlots.isActive, active));
    const where = filters.length ? and(...filters) : undefined;
    const sortColumn = query.sortBy === "project" ? projects.name : query.sortBy === "dayOfWeek" ? projectPublishSlots.dayOfWeek : projectPublishSlots.publishTime;
    const order = query.sortOrder === "asc" ? asc : desc;
    const [rows, totals] = await Promise.all([
      c.get("db").select({ slot: projectPublishSlots, projectId: projects.id, projectName: projects.name }).from(projectPublishSlots).innerJoin(projects, eq(projectPublishSlots.projectId, projects.id)).where(where).orderBy(order(sortColumn), order(projectPublishSlots.id)).limit(query.limit).offset(query.offset),
      c.get("db").select({ count: count() }).from(projectPublishSlots).innerJoin(projects, eq(projectPublishSlots.projectId, projects.id)).where(where),
    ]);
    const items = rows.map((row: any) => ({ ...row.slot, project: { id: row.projectId, name: row.projectName } }));
    return c.json({ status: "success", message: "Publish slots retrieved successfully", data: paginated(items, Number(totals[0]?.count || 0), query.page, query.limit) });
  } catch (error) { return handleApiError(c, error); }
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
  try {
    const query = parseListQuery(c, { allowedSort: ["publishDate", "publishTime", "createdAt"] as const, defaultSort: "publishDate", defaultLimit: 100 });
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) return c.json({ status: "error", code: "VALIDATION_ERROR", message: "from and to are required", data: null, errors: {} }, 400);
    const filters: any[] = [gte(clipPublishSchedules.publishDate, from), lte(clipPublishSchedules.publishDate, to)];
    if (c.req.query("projectId")) filters.push(eq(clipPublishSchedules.projectId, c.req.query("projectId")!));
    const statuses = parseMultiValue(c, "status");
    if (statuses.length) filters.push(inArray(clipPublishSchedules.status, statuses as any));
    const postingState = c.req.query("postingState");
    if (postingState === "unposted") filters.push(sql`(select count(*) from published_posts pp where pp.clip_id = ${clipPublishSchedules.clipId}) = 0`);
    if (postingState === "partial") filters.push(sql`(select count(distinct pp.platform) from published_posts pp where pp.clip_id = ${clipPublishSchedules.clipId}) between 1 and 3`);
    if (postingState === "completed") filters.push(sql`(select count(distinct pp.platform) from published_posts pp where pp.clip_id = ${clipPublishSchedules.clipId}) >= 4`);
    const where = and(...filters);
    const sortColumns = { publishDate: clipPublishSchedules.publishDate, publishTime: clipPublishSchedules.publishTime, createdAt: clipPublishSchedules.createdAt };
    const order = query.sortOrder === "asc" ? asc : desc;
    const [rows, totals] = await Promise.all([
      c.get("db").query.clipPublishSchedules.findMany({
        where,
        with: { project: { columns: { id: true, name: true } }, slot: true, clip: { with: { episode: { columns: { id: true, episodeNo: true, name: true } }, owner: { columns: { id: true, displayName: true, pictureUrl: true } }, publishedPosts: true, currentRevision: { columns: { id: true, driveUrl: true, revisionNo: true } } } } },
        orderBy: [order(sortColumns[query.sortBy]), order(clipPublishSchedules.id)], limit: query.limit, offset: query.offset,
      }),
      c.get("db").select({ count: count() }).from(clipPublishSchedules).where(where),
    ]);
    return c.json({ status: "success", message: "Publish queue retrieved successfully", data: paginated(rows, Number(totals[0]?.count || 0), query.page, query.limit) });
  } catch (error) { return handleApiError(c, error); }
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
  if (clipIds.length > 100) return c.json({ status: "error", code: "VALIDATION_ERROR", message: "A maximum of 100 clips is allowed", data: null, errors: {} }, 400);
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

publishSchedulesRouter.post("/queue/bulk", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const entries = Array.isArray(body.items) ? body.items : [];
  if (!entries.length || entries.length > 100) {
    return c.json({ status: "error", code: "VALIDATION_ERROR", message: "items must contain between 1 and 100 schedules", data: null, errors: {} }, 400);
  }
  const prepared: any[] = [];
  for (const entry of entries) {
    const clipId = String(entry.clipId || "");
    const scheduledAt = new Date(String(entry.scheduledAt || ""));
    if (!clipId || Number.isNaN(scheduledAt.getTime())) return c.json({ status: "error", code: "VALIDATION_ERROR", message: "Every item requires clipId and a valid scheduledAt", data: null, errors: {} }, 400);
    const clip = await c.get("db").query.clips.findFirst({ where: (row: any, { eq }: any) => eq(row.id, clipId), columns: { id: true, projectId: true, name: true } });
    if (!clip) return c.json({ status: "error", code: "NOT_FOUND", message: "Clip not found", data: null, errors: { clipId } }, 404);
    prepared.push({ entry, clip, clipId, scheduledAt, publishDate: bangkokDateString(scheduledAt), publishTime: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(scheduledAt) });
  }
  const conflicts: any[] = [];
  for (const item of prepared) {
    if (item.entry.allowSameDay) continue;
    const conflict = await c.get("db").query.clipPublishSchedules.findFirst({
      where: (row: any, { and, eq, ne }: any) => and(eq(row.projectId, item.clip.projectId), eq(row.publishDate, item.publishDate), ne(row.clipId, item.clipId), eq(row.status, "SCHEDULED")),
      with: { clip: { columns: { id: true, name: true } } },
    });
    const duplicateInRequest = prepared.find((other) => other !== item && other.clip.projectId === item.clip.projectId && other.publishDate === item.publishDate && !other.entry.allowSameDay);
    if (conflict || duplicateInRequest) conflicts.push({ clipId: item.clipId, publishDate: item.publishDate, conflict: conflict || { clip: duplicateInRequest.clip } });
  }
  if (conflicts.length) return c.json({ status: "error", code: "SCHEDULE_CONFLICT", message: "Some schedules conflict", data: { conflicts }, errors: {} }, 409);
  const schedules = await c.get("db").transaction(async (tx: any) => {
    const saved = [];
    for (const item of prepared) {
      const [schedule] = await tx.insert(clipPublishSchedules).values({ projectId: item.clip.projectId, clipId: item.clipId, slotId: item.entry.slotId || null, publishDate: item.publishDate, publishTime: item.publishTime, isRepeat: Boolean(item.entry.allowSameDay), note: item.entry.note || null, createdBy: c.get("user")?.id || null }).onConflictDoUpdate({ target: clipPublishSchedules.clipId, set: { slotId: item.entry.slotId || null, publishDate: item.publishDate, publishTime: item.publishTime, isRepeat: Boolean(item.entry.allowSameDay), note: item.entry.note || null, status: "SCHEDULED", updatedAt: new Date() } }).returning();
      await tx.update(clips).set({ scheduledPublishAt: item.scheduledAt, updatedAt: new Date() }).where(eq(clips.id, item.clipId));
      saved.push(schedule);
    }
    return saved;
  });
  return c.json({ status: "success", message: "Publish queue saved successfully", data: schedules }, 201);
});
