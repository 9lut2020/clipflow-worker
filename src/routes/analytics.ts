import { Hono, type Context } from "hono";
import { createDb, rawEvents, dailyMetrics } from "@clipflow/db";
import { asc, desc, eq, and, gte, lte, count, sql } from "drizzle-orm";
import { adminOnly } from "../middleware/role";
import { handleApiError, paginated, parseDate, parseListQuery } from "../lib/api-contract";

export const analyticsRouter = new Hono<{
  Bindings: { DATABASE_URL: string };
  Variables: {
    db: ReturnType<typeof createDb>;
    user: { id: string; role: string; lineUserId: string };
  };
}>();

// authMiddleware already runs for every /api route; tracking is fire-and-forget
// so the client never waits on the insert.
analyticsRouter.post("/track", async (c: Context) => {
  const db = c.get("db");
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  const eventName = body?.eventName;
  if (!eventName || typeof eventName !== "string") {
    return c.json({ status: "error", message: "eventName is required" }, 400);
  }

  const insert = db.insert(rawEvents).values({
    eventName: eventName.slice(0, 100),
    userId: user.id,
    properties: body.properties || {},
    context: body.context || {},
  }).catch((error: unknown) => console.error("Analytics track error:", error));
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(insert);
  else await insert;

  return c.json({ status: "success" }, 202);
});

analyticsRouter.get("/metrics", adminOnly, async (c: Context) => {
  const db = c.get("db");
  try {
    const query = parseListQuery(c, { allowedSort: ["date", "metricName", "dimension", "createdAt"] as const, defaultSort: "date" });
    const filters: any[] = [];
    const from = parseDate(c.req.query("from"), "from"); const to = parseDate(c.req.query("to"), "to");
    if (from) filters.push(gte(dailyMetrics.date, from));
    if (to) filters.push(lte(dailyMetrics.date, to));
    if (c.req.query("metricName")) filters.push(eq(dailyMetrics.metricName, c.req.query("metricName")!));
    if (c.req.query("dimension")) filters.push(eq(dailyMetrics.dimension, c.req.query("dimension")!));
    const where = filters.length ? and(...filters) : undefined;
    const columns = { date: dailyMetrics.date, metricName: dailyMetrics.metricName, dimension: dailyMetrics.dimension, createdAt: dailyMetrics.createdAt };
    const order = query.sortOrder === "asc" ? asc : desc;
    const [items, totals] = await Promise.all([
      db.select().from(dailyMetrics).where(where).orderBy(order(columns[query.sortBy]), order(dailyMetrics.id)).limit(query.limit).offset(query.offset),
      db.select({ count: count() }).from(dailyMetrics).where(where),
    ]);
    return c.json({ status: "success", message: "Metrics retrieved successfully", data: paginated(items, Number(totals[0]?.count || 0), query.page, query.limit) });
  } catch (error: any) {
    return handleApiError(c, error);
  }
});

/**
 * GET /analytics/overview?range=7|30|90|all&projectId=
 * Role-scoped production analytics, aggregated in SQL:
 *  - USER sees only their own clips; REVIEWER sees all submitted work;
 *    ADMIN sees everything plus reviewer stats.
 *  - "range" filters activity (submissions, reviews, approvals); the status
 *    snapshot and project progress always reflect the current state.
 */
analyticsRouter.get("/overview", async (c: Context) => {
  try {
    const db = c.get("db") as any;
    const user = c.get("user") as { id: string; role: "USER" | "REVIEWER" | "ADMIN" };
    const rangeParam = c.req.query("range") || "30";
    const days = rangeParam === "all" ? null : [7, 30, 90].includes(Number(rangeParam)) ? Number(rangeParam) : 30;
    const projectId = c.req.query("projectId");
    if (projectId && !/^[0-9a-f-]{36}$/i.test(projectId)) {
      return c.json({ status: "error", code: "VALIDATION_ERROR", message: "Invalid projectId", data: null }, 400);
    }

    const scopeParts = [sql`true`];
    if (user.role === "USER") scopeParts.push(sql`c.owner_id = ${user.id}`);
    if (user.role === "REVIEWER") scopeParts.push(sql`c.status not in ('DRAFT', 'CANCELLED')`);
    if (projectId) scopeParts.push(sql`c.project_id = ${projectId}`);
    const sc = sql`sc as (select c.id, c.project_id, c.owner_id, c.status from clips c where ${sql.join(scopeParts, sql` and `)})`;
    const since = (column: any) => (days ? sql`${column} >= now() - make_interval(days => ${days})` : sql`true`);
    // "All time" trend shows the last 12 months by month.
    const trendSince = (column: any) => (days ? since(column) : sql`${column} >= now() - interval '12 months'`);
    const bucket = days ? sql.raw(`'day'`) : sql.raw(`'month'`);
    // Latest approval per clip in range, with the revision number it passed on.
    const appr = sql`appr as (
      select distinct on (rv.clip_id) rv.clip_id, rv.created_at, r.revision_no
      from reviews rv join sc on sc.id = rv.clip_id join revisions r on r.id = rv.revision_id
      where rv.status = 'APPROVED' and ${since(sql`rv.created_at`)}
      order by rv.clip_id, rv.created_at desc)`;
    const rows = (result: any) => (Array.isArray(result) ? result : result?.rows ?? []);

    const [kpiRes, statusRes, trendRes, projectRes, editorRes, reviewerRes, projectOptions] = await Promise.all([
      db.execute(sql`with ${sc}, ${appr},
        subs as (select r.id from revisions r join sc on sc.id = r.clip_id where ${since(sql`r.submitted_at`)}),
        revs as (select rv.status, rv.created_at, r.submitted_at from reviews rv join sc on sc.id = rv.clip_id join revisions r on r.id = rv.revision_id where ${since(sql`rv.created_at`)}),
        first_sub as (select r.clip_id, min(r.submitted_at) first_at from revisions r join sc on sc.id = r.clip_id group by r.clip_id)
        select
          (select count(*)::int from subs) submitted,
          (select count(*)::int from revs where status = 'APPROVED') approved_reviews,
          (select count(*)::int from revs where status = 'NEEDS_REVISION') revision_requests,
          (select count(*)::int from appr) approved_clips,
          (select count(*)::int from appr where revision_no = 1) first_pass,
          (select round(avg(revision_no)::numeric, 2) from appr) avg_revisions,
          (select round((avg(extract(epoch from (a.created_at - f.first_at))) / 3600)::numeric, 1) from appr a join first_sub f on f.clip_id = a.clip_id) avg_turnaround_hours,
          (select round((avg(extract(epoch from (created_at - submitted_at))) / 3600)::numeric, 1) from revs) avg_review_hours`),
      db.execute(sql`with ${sc} select status, count(*)::int n from sc group by status`),
      db.execute(sql`with ${sc}
        select to_char(b, 'YYYY-MM-DD') bucket, sum(s)::int submitted, sum(a)::int approved from (
          select date_trunc(${bucket}, r.submitted_at at time zone 'Asia/Bangkok') b, 1 s, 0 a
            from revisions r join sc on sc.id = r.clip_id where ${trendSince(sql`r.submitted_at`)}
          union all
          select date_trunc(${bucket}, rv.created_at at time zone 'Asia/Bangkok') b, 0 s, 1 a
            from reviews rv join sc on sc.id = rv.clip_id where rv.status = 'APPROVED' and ${trendSince(sql`rv.created_at`)}
        ) t group by b order by b`),
      db.execute(sql`with ${sc}
        select p.id, p.name, count(*)::int total,
          count(*) filter (where sc.status in ('APPROVED', 'PUBLISHED'))::int done,
          count(*) filter (where sc.status in ('PENDING_REVIEW', 'IN_REVIEW', 'RESUBMITTED'))::int in_review,
          count(*) filter (where sc.status = 'NEEDS_REVISION')::int needs_revision,
          count(*) filter (where sc.status = 'DRAFT')::int not_started
        from sc join projects p on p.id = sc.project_id
        where p.is_active group by p.id, p.name order by total desc, p.name limit 8`),
      user.role === "USER"
        ? Promise.resolve([])
        : db.execute(sql`with ${sc}, ${appr},
          subs_by as (select r.submitted_by uid, count(*)::int n from revisions r join sc on sc.id = r.clip_id where ${since(sql`r.submitted_at`)} group by 1),
          appr_by as (select c.owner_id uid, count(*)::int approved, count(*) filter (where a.revision_no = 1)::int first_pass, round(avg(a.revision_no)::numeric, 2) avg_revisions from appr a join clips c on c.id = a.clip_id group by 1)
          select u.id, u.display_name name, u.picture_url, count(sc.id)::int assigned,
            coalesce(sb.n, 0) submissions, coalesce(ab.approved, 0) approved, coalesce(ab.first_pass, 0) first_pass, ab.avg_revisions
          from sc join users u on u.id = sc.owner_id
          left join subs_by sb on sb.uid = u.id left join appr_by ab on ab.uid = u.id
          group by u.id, u.display_name, u.picture_url, sb.n, ab.approved, ab.first_pass, ab.avg_revisions
          order by approved desc, assigned desc, name limit 10`),
      user.role !== "ADMIN"
        ? Promise.resolve([])
        : db.execute(sql`with ${sc}
          select u.id, u.display_name name, u.picture_url, count(*)::int reviews,
            count(*) filter (where rv.status = 'APPROVED')::int approved,
            count(*) filter (where rv.status = 'NEEDS_REVISION')::int sent_back,
            round((avg(extract(epoch from (rv.created_at - r.submitted_at))) / 3600)::numeric, 1) avg_review_hours
          from reviews rv join sc on sc.id = rv.clip_id join revisions r on r.id = rv.revision_id join users u on u.id = rv.reviewer_id
          where ${since(sql`rv.created_at`)}
          group by u.id, u.display_name, u.picture_url order by reviews desc limit 10`),
      user.role === "USER"
        ? db.execute(sql`select p.id, p.name from projects p join user_projects up on up.project_id = p.id where up.user_id = ${user.id} and p.is_active order by p.name`)
        : db.execute(sql`select id, name from projects where is_active order by name`),
    ]);

    const k = rows(kpiRes)[0] || {};
    const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
    const approvedClips = Number(k.approved_clips || 0);

    // Fill empty buckets so the line has a point for every day/month.
    const trendMap = new Map<string, { submitted: number; approved: number }>(
      rows(trendRes).map((r: any) => [r.bucket, { submitted: Number(r.submitted), approved: Number(r.approved) }]),
    );
    const trend: { date: string; submitted: number; approved: number }[] = [];
    const nowBangkok = new Date(Date.now() + 7 * 3600 * 1000);
    if (days) {
      for (let i = days - 1; i >= 0; i -= 1) {
        const d = new Date(nowBangkok);
        d.setUTCDate(d.getUTCDate() - i);
        const key = d.toISOString().slice(0, 10);
        trend.push({ date: key, ...(trendMap.get(key) || { submitted: 0, approved: 0 }) });
      }
    } else {
      for (let i = 11; i >= 0; i -= 1) {
        const d = new Date(Date.UTC(nowBangkok.getUTCFullYear(), nowBangkok.getUTCMonth() - i, 1));
        const key = d.toISOString().slice(0, 10);
        trend.push({ date: key, ...(trendMap.get(key) || { submitted: 0, approved: 0 }) });
      }
    }

    return c.json({
      status: "success",
      message: "Analytics overview retrieved",
      data: {
        scope: user.role === "USER" ? "self" : "team",
        range: days ? String(days) : "all",
        granularity: days ? "day" : "month",
        kpis: {
          submitted: Number(k.submitted || 0),
          approvedReviews: Number(k.approved_reviews || 0),
          revisionRequests: Number(k.revision_requests || 0),
          approvedClips,
          firstPassRate: approvedClips ? Math.round((Number(k.first_pass || 0) / approvedClips) * 100) : null,
          avgRevisions: num(k.avg_revisions),
          avgTurnaroundHours: num(k.avg_turnaround_hours),
          avgReviewHours: num(k.avg_review_hours),
        },
        statusCounts: Object.fromEntries(rows(statusRes).map((r: any) => [r.status, Number(r.n)])),
        trend,
        projects: rows(projectRes).map((r: any) => ({
          id: r.id, name: r.name, total: Number(r.total), done: Number(r.done),
          inReview: Number(r.in_review), needsRevision: Number(r.needs_revision), notStarted: Number(r.not_started),
        })),
        editors: rows(editorRes).map((r: any) => ({
          id: r.id, name: r.name, pictureUrl: r.picture_url, assigned: Number(r.assigned), submissions: Number(r.submissions),
          approved: Number(r.approved),
          firstPassRate: Number(r.approved) ? Math.round((Number(r.first_pass) / Number(r.approved)) * 100) : null,
          avgRevisions: num(r.avg_revisions),
        })),
        reviewers: rows(reviewerRes).map((r: any) => ({
          id: r.id, name: r.name, pictureUrl: r.picture_url, reviews: Number(r.reviews), approved: Number(r.approved),
          sentBack: Number(r.sent_back), avgReviewHours: num(r.avg_review_hours),
        })),
        projectOptions: rows(projectOptions).map((r: any) => ({ id: r.id, name: r.name })),
      },
    });
  } catch (error) {
    return handleApiError(c, error);
  }
});
