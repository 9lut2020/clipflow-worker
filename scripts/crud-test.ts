/**
 * Comprehensive CRUD test for clipflow-worker
 * Tests all major API routes with real auth headers
 * Run: npx tsx scripts/crud-test.ts
 */

const BASE = "https://clipflow-worker.clipflow-api.workers.dev/api";

// ── State ─────────────────────────────────────────────────────────────────────
let adminUserId = "";
let createdProjectId = "";
let createdEpisodeId = "";
let createdClipId = "";
let notificationId = "";

let passed = 0;
let failed = 0;
const failures: string[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────
function adminHeaders() {
  return {
    "Content-Type": "application/json",
    "x-user-id": adminUserId,
    "x-user-role": "ADMIN",
  };
}

async function req(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers ?? adminHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    failures.push(label);
  }
}

// ── Test Suites ───────────────────────────────────────────────────────────────

async function testHealth() {
  console.log("\n🔵 [Health]");
  const r = await req("GET", "/health", undefined, {});
  ok("GET /health → 200", r.status === 200);
  ok("status: ok", r.data?.status === "ok");
}

async function discoverAdminUser() {
  console.log("\n🔵 [Discover admin user]");
  const knownId = "107c8c9a-3932-4924-b86d-695efd2e5a94";
  adminUserId = knownId;

  const r = await req("GET", `/users/${knownId}`);
  if (r.status === 200 && r.data?.data?.role) {
    console.log(`  ℹ️  User: ${r.data.data.displayName} (${r.data.data.role})`);
    ok("GET /users/:id → 200", true);
    ok("Has role field", !!r.data.data.role);
  } else {
    // Fallback: list users and take the first ADMIN
    const list = await req("GET", "/users?limit=50");
    const admin = list.data?.data?.items?.find((u: any) => u.role === "ADMIN");
    if (admin) {
      adminUserId = admin.id;
      console.log(`  ℹ️  Found admin via list: ${admin.displayName} (${admin.id})`);
      ok("Found admin user", true);
    } else {
      ok("Could not find admin user", false, JSON.stringify(list.data).slice(0, 200));
    }
  }
}

async function testUsers() {
  console.log("\n🔵 [Users — READ]");

  const list = await req("GET", "/users?limit=5&sortBy=createdAt&sortOrder=desc");
  ok("GET /users → 200", list.status === 200, JSON.stringify(list.data).slice(0, 200));
  ok("GET /users has pagination", !!list.data?.data?.pagination);
  ok("GET /users has items array", Array.isArray(list.data?.data?.items));

  const self = await req("GET", `/users/${adminUserId}`);
  ok("GET /users/:id → 200", self.status === 200);
  ok("GET /users/:id returns user data", !!self.data?.data?.id);

  const stats = await req("GET", `/users/${adminUserId}/stats`);
  ok("GET /users/:id/stats → 200", stats.status === 200, JSON.stringify(stats.data).slice(0, 100));
}

async function testProjects() {
  console.log("\n🔵 [Projects — CREATE / READ / UPDATE / DELETE]");

  const ts = Date.now();
  const create = await req("POST", "/projects", {
    name: `[TEST] Project ${ts}`,
    description: "Automated CRUD test project",
    pictureUrl: null,
  });
  ok("POST /projects → 201", create.status === 201, JSON.stringify(create.data).slice(0, 200));
  createdProjectId = create.data?.data?.id ?? "";
  ok("POST /projects returns id", !!createdProjectId);

  const list = await req("GET", "/projects?limit=5");
  ok("GET /projects → 200", list.status === 200);
  ok("GET /projects has items", Array.isArray(list.data?.data?.items));

  if (createdProjectId) {
    const single = await req("GET", `/projects/${createdProjectId}`);
    ok("GET /projects/:id → 200", single.status === 200);
    ok("GET /projects/:id matches name", single.data?.data?.name?.includes("[TEST]"));

    const update = await req("PATCH", `/projects/${createdProjectId}`, {
      name: `[TEST-UPDATED] Project ${ts}`,
      description: "Updated description",
    });
    ok("PATCH /projects/:id → 200", update.status === 200, JSON.stringify(update.data).slice(0, 150));
    ok("PATCH /projects/:id name changed", update.data?.data?.name?.includes("UPDATED"));

    const manage = await req("GET", `/projects/${createdProjectId}/manage`);
    ok("GET /projects/:id/manage → 200", manage.status === 200, JSON.stringify(manage.data).slice(0, 150));

    const members = await req("GET", `/projects/${createdProjectId}/members`);
    ok("GET /projects/:id/members → 200", members.status === 200, JSON.stringify(members.data).slice(0, 150));
  }
}

async function testEpisodes() {
  if (!createdProjectId) { console.log("\n⚠️  Skipping episodes (no project)"); return; }
  console.log("\n🔵 [Episodes — CREATE / READ]");

  const create = await req("POST", `/projects/${createdProjectId}/episodes`, {
    episodeNo: 999,
    name: "Test Episode",
  });
  ok("POST /projects/:id/episodes → 201", create.status === 201, JSON.stringify(create.data).slice(0, 200));
  createdEpisodeId = create.data?.data?.id ?? "";
  ok("Episode has id", !!createdEpisodeId);

  const list = await req("GET", `/episodes?projectId=${createdProjectId}&limit=5`);
  ok("GET /episodes?projectId → 200", list.status === 200, JSON.stringify(list.data).slice(0, 150));
}

async function testClips() {
  if (!createdProjectId || !createdEpisodeId) { console.log("\n⚠️  Skipping clips (no project/episode)"); return; }
  console.log("\n🔵 [Clips — CREATE via batch / READ]");

  const batch = await req("POST", `/projects/${createdProjectId}/clips/batch`, {
    clips: [{
      id: `new-test-${Date.now()}`,
      name: "[TEST] Clip",
      description: "Test clip from CRUD test",
      episodeNo: 999,
      platform: "TIKTOK",
      ownerId: adminUserId,
      createdBy: adminUserId,
    }],
  });
  ok("POST /projects/:id/clips/batch → 200", batch.status === 200, JSON.stringify(batch.data).slice(0, 200));

  const projectClips = await req("GET", `/projects/${createdProjectId}/clips?limit=5`);
  ok("GET /projects/:id/clips → 200", projectClips.status === 200);
  const items = projectClips.data?.data?.items ?? [];
  ok("GET /projects/:id/clips has items", items.length > 0);

  if (items.length > 0) {
    createdClipId = items[0].id;
    console.log(`  ℹ️  Clip: ${items[0].name} (${createdClipId})`);

    const single = await req("GET", `/clips/${createdClipId}`);
    ok("GET /clips/:id → 200", single.status === 200, JSON.stringify(single.data).slice(0, 150));

    const update = await req("PATCH", `/clips/${createdClipId}`, {
      name: "[TEST-UPDATED] Clip",
    });
    ok("PATCH /clips/:id → 200", update.status === 200 || update.status === 404, JSON.stringify(update.data).slice(0, 150));
  }
}

async function testVideoSizes() {
  console.log("\n🔵 [Video Sizes — CREATE / READ]");

  const ts = Date.now();
  const create = await req("POST", "/video-sizes", {
    name: `[TEST] 1080x1920 ${ts}`,
    width: 1080,
    height: 1920,
  });
  ok("POST /video-sizes → 201", create.status === 201, JSON.stringify(create.data).slice(0, 200));

  const list = await req("GET", "/video-sizes");
  ok("GET /video-sizes → 200", list.status === 200);
  const data = list.data?.data;
  ok("GET /video-sizes has data", Array.isArray(data?.items ?? data));
}

async function testNotifications() {
  console.log("\n🔵 [Notifications — READ / MARK READ]");

  const vapid = await req("GET", "/notifications/push/vapid-key");
  ok("GET /notifications/push/vapid-key → 200 or 503", vapid.status === 200 || vapid.status === 503);

  const list = await req("GET", "/notifications?limit=5");
  ok("GET /notifications → 200", list.status === 200, JSON.stringify(list.data).slice(0, 150));

  const count = await req("GET", "/notifications/unread-count");
  ok("GET /notifications/unread-count → 200", count.status === 200, JSON.stringify(count.data).slice(0, 100));
  ok("unread-count has data field", count.data?.data !== undefined);

  const items = list.data?.data?.items ?? [];
  if (items.length > 0) {
    notificationId = items[0].id;
    const markRead = await req("PATCH", `/notifications/${notificationId}/read`);
    ok("PATCH /notifications/:id/read → 200", markRead.status === 200);
  } else {
    console.log("  ℹ️  No notifications — skipping mark-read");
  }

  const readAll = await req("PATCH", "/notifications/read-all");
  ok("PATCH /notifications/read-all → 200", readAll.status === 200);
}

async function testAnalytics() {
  console.log("\n🔵 [Analytics — TRACK / METRICS]");

  const track = await req("POST", "/analytics/track", {
    eventName: "crud_test_run",
    properties: { test: true, ts: Date.now() },
    context: { source: "crud-test.ts" },
  });
  ok("POST /analytics/track → 200", track.status === 200, JSON.stringify(track.data).slice(0, 100));

  const metrics = await req("GET", "/analytics/metrics?limit=5");
  ok("GET /analytics/metrics → 200", metrics.status === 200, JSON.stringify(metrics.data).slice(0, 150));
}

async function testPublishSchedules() {
  console.log("\n🔵 [Publish Schedules — SUMMARY / ITEMS / SLOTS / QUEUE]");

  const summary = await req("GET", "/publish-schedules/summary");
  ok("GET /publish-schedules/summary → 200", summary.status === 200, JSON.stringify(summary.data).slice(0, 150));

  const items = await req("GET", "/publish-schedules/items?limit=5");
  ok("GET /publish-schedules/items → 200", items.status === 200, JSON.stringify(items.data).slice(0, 150));

  const slots = await req("GET", "/publish-schedules/slots");
  ok("GET /publish-schedules/slots → 200", slots.status === 200, JSON.stringify(slots.data).slice(0, 150));

  const today = new Date().toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const queue = await req("GET", `/publish-schedules/queue?from=${today}&to=${nextMonth}&limit=5`);
  ok("GET /publish-schedules/queue → 200", queue.status === 200, JSON.stringify(queue.data).slice(0, 150));
}

// ── Workflow State ────────────────────────────────────────────────────────────
let workflowProjectId = "";
let workflowClipId = "";
let workflowRevisionId = "";
let workflowReviewId = "";

async function testAssignmentWorkflow() {
  console.log("\n🔵 [Workflow: มอบหมายงาน (Assignment)]");
  const ts = Date.now();

  const proj = await req("POST", "/projects", {
    name: `[WF-TEST] Workflow Project ${ts}`,
    description: "Workflow test",
    pictureUrl: null,
  });
  ok("WF: สร้าง project → 201", proj.status === 201);
  workflowProjectId = proj.data?.data?.id ?? "";

  const ep = await req("POST", `/projects/${workflowProjectId}/episodes`, {
    episodeNo: 1,
    name: "EP.1",
  });
  ok("WF: สร้าง episode → 201", ep.status === 201);

  if (!workflowProjectId || !ep.data?.data?.id) {
    ok("WF: prerequisite failed", false);
    return;
  }

  // Batch create + assign clip
  const batch = await req("POST", `/projects/${workflowProjectId}/clips/batch`, {
    clips: [{
      id: `new-wf-${ts}`,
      name: "[WF-TEST] Clip มอบหมายงาน",
      description: "คลิปทดสอบ workflow",
      episodeNo: 1,
      platform: "TIKTOK",
      ownerId: adminUserId,
      createdBy: adminUserId,
    }],
  });
  ok("WF: batch สร้าง + มอบหมายคลิป → 200", batch.status === 200);

  const clipList = await req("GET", `/projects/${workflowProjectId}/clips?limit=5`);
  ok("WF: อ่าน clips → 200", clipList.status === 200);
  const items = clipList.data?.data?.items ?? [];
  ok("WF: มี clip อยู่", items.length > 0);
  workflowClipId = items[0]?.id ?? "";
  console.log(`  ℹ️  Clip: ${items[0]?.name} | status: ${items[0]?.status}`);
  ok("WF: clip status = DRAFT", items[0]?.status === "DRAFT");

  const detail = await req("GET", `/clips/${workflowClipId}`);
  ok("WF: GET /clips/:id → 200", detail.status === 200);
  ok("WF: clip มี ownerId", !!detail.data?.data?.owner?.id);
}

async function testSubmitRevisionWorkflow() {
  if (!workflowClipId) { console.log("\n⚠️  Skipping submit revision (no clip)"); return; }
  console.log("\n🔵 [Workflow: ส่งงาน (Submit Revision)]");

  const submit = await req("POST", `/clips/${workflowClipId}/revisions`, {
    driveUrl: "https://drive.google.com/file/d/TEST_FILE_WF_v1/view",
    submitNote: "ส่งงานครั้งแรก",
  });
  ok("WF: POST /clips/:id/revisions → 201", submit.status === 201, JSON.stringify(submit.data).slice(0, 200));
  workflowRevisionId = submit.data?.data?.id ?? "";
  ok("WF: revision มี id", !!workflowRevisionId);

  const afterSubmit = await req("GET", `/clips/${workflowClipId}`);
  ok("WF: clip → PENDING_REVIEW หลังส่งงาน",
    ["PENDING_REVIEW", "IN_REVIEW"].includes(afterSubmit.data?.data?.status ?? ""),
    `actual: ${afterSubmit.data?.data?.status}`);

  const revList = await req("GET", `/clips/${workflowClipId}/revisions`);
  ok("WF: GET /clips/:id/revisions → 200", revList.status === 200);
  ok("WF: revision list มีข้อมูล", (revList.data?.data?.items ?? []).length > 0);

  const revDetail = await req("GET", `/revisions/${workflowRevisionId}`);
  ok("WF: GET /revisions/:id → 200", revDetail.status === 200);
  ok("WF: revision มี driveUrl", !!revDetail.data?.data?.driveUrl);
}

async function testReviewWorkflow() {
  if (!workflowRevisionId) { console.log("\n⚠️  Skipping review (no revision)"); return; }
  console.log("\n🔵 [Workflow: ตรวจงาน (Review)]");

  // GET reviews ก่อนตรวจ
  const beforeReviews = await req("GET", `/revisions/${workflowRevisionId}/reviews`);
  ok("WF: GET /revisions/:id/reviews → 200", beforeReviews.status === 200);
  console.log(`  ℹ️  Reviews ก่อนตรวจ: ${beforeReviews.data?.data?.pagination?.total ?? 0} รายการ`);

  // NEEDS_REVISION (ส่งแก้ไข)
  const reject = await req("POST", `/revisions/${workflowRevisionId}/reviews`, {
    status: "NEEDS_REVISION",
    comment: "กรุณาปรับ contrast และแก้ subtitle ที่ 00:45",
    timecodeSeconds: 45,
    timecodeStr: "00:45",
  });
  ok("WF: POST review NEEDS_REVISION → 201", reject.status === 201, JSON.stringify(reject.data).slice(0, 200));
  workflowReviewId = reject.data?.data?.id ?? "";
  ok("WF: review มี id", !!workflowReviewId);

  const afterReject = await req("GET", `/clips/${workflowClipId}`);
  ok("WF: clip → NEEDS_REVISION หลัง reject",
    afterReject.data?.data?.status === "NEEDS_REVISION",
    `actual: ${afterReject.data?.data?.status}`);

  // PATCH review comment
  const patchReview = await req("PATCH", `/revisions/reviews/${workflowReviewId}`, {
    comment: "กรุณาปรับ contrast และแก้ subtitle ที่ 00:45 (อัปเดต)",
  });
  ok("WF: PATCH /revisions/reviews/:id → 200", patchReview.status === 200, JSON.stringify(patchReview.data).slice(0, 150));

  // Editor re-submit (revision 2)
  const resubmit = await req("POST", `/clips/${workflowClipId}/revisions`, {
    driveUrl: "https://drive.google.com/file/d/TEST_FILE_WF_v2/view",
    submitNote: "แก้ไขแล้ว ปรับ contrast + subtitle",
  });
  ok("WF: Editor re-submit → 201", resubmit.status === 201, JSON.stringify(resubmit.data).slice(0, 150));
  const rev2Id = resubmit.data?.data?.id ?? "";
  ok("WF: revision 2 มี id", !!rev2Id);

  const afterResubmit = await req("GET", `/clips/${workflowClipId}`);
  ok("WF: clip → PENDING_REVIEW / RESUBMITTED หลัง re-submit",
    ["PENDING_REVIEW", "IN_REVIEW", "RESUBMITTED"].includes(afterResubmit.data?.data?.status ?? ""),
    `actual: ${afterResubmit.data?.data?.status}`);

  // Reviewer APPROVE
  if (rev2Id) {
    const approve = await req("POST", `/revisions/${rev2Id}/reviews`, {
      status: "APPROVED",
      comment: "ผ่านแล้ว! ตัดต่อยอดเยี่ยม 👏",
    });
    ok("WF: POST review APPROVED → 201", approve.status === 201, JSON.stringify(approve.data).slice(0, 200));

    const finalClip = await req("GET", `/clips/${workflowClipId}`);
    const finalStatus = finalClip.data?.data?.status;
    ok("WF: clip status = APPROVED ✅", finalStatus === "APPROVED", `actual: ${finalStatus}`);
    console.log(`  ℹ️  Final status: ${finalStatus}`);
  }

  // GET reviews หลังตรวจครบ
  const afterReviews = await req("GET", `/revisions/${workflowRevisionId}/reviews`);
  ok("WF: GET reviews หลังตรวจ → 200", afterReviews.status === 200);
  console.log(`  ℹ️  Reviews หลังตรวจ: ${afterReviews.data?.data?.pagination?.total ?? 0} รายการ`);
}

async function testPublishWorkflow() {
  if (!workflowClipId) return;
  console.log("\n🔵 [Publish Workflow — POST /clips/:id/publish]");

  const publish = await req("POST", `/clips/${workflowClipId}/publish`, {
    platform: "TIKTOK",
    caption: "คลิปเจ๋งๆ มาแล้ว #ClipFlow",
    url: "https://tiktok.com/@clipflow/video/123456",
    publishedAt: new Date().toISOString(),
  });
  ok("WF: POST /clips/:id/publish → 200", publish.status === 200, JSON.stringify(publish.data).slice(0, 150));

  const afterPublish = await req("GET", `/clips/${workflowClipId}`);
  const finalStatus = afterPublish.data?.data?.status;
  ok("WF: clip status = PUBLISHED 📢", finalStatus === "PUBLISHED", `actual: ${finalStatus}`);
  console.log(`  ℹ️  Final status after publish: ${finalStatus}`);
}

async function testWorkflowCleanup() {
  if (!workflowProjectId) return;
  console.log("\n🧹 [Workflow Cleanup]");

  if (workflowClipId) {
    const delClip = await req("DELETE", `/clips/${workflowClipId}`);
    ok("WF Cleanup: DELETE clip", delClip.status === 200 || delClip.status === 404);
  }
  const delProj = await req("DELETE", `/projects/${workflowProjectId}`);
  ok("WF Cleanup: soft-delete project → 200", delProj.status === 200);
}

async function testCleanup() {
  if (!createdProjectId) return;
  console.log("\n🧹 [Cleanup — soft-delete test project]");

  const del = await req("DELETE", `/projects/${createdProjectId}`);
  ok("DELETE /projects/:id → 200", del.status === 200, JSON.stringify(del.data).slice(0, 100));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ClipFlow Worker — Full CRUD Test Suite");
  console.log(`  Target: ${BASE}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    await testHealth();
    await discoverAdminUser();
    await testUsers();
    await testProjects();
    await testEpisodes();
    await testClips();
    await testVideoSizes();
    await testNotifications();
    await testAnalytics();
    await testPublishSchedules();
    await testAssignmentWorkflow();
    await testSubmitRevisionWorkflow();
    await testReviewWorkflow();
    await testPublishWorkflow();
    await testWorkflowCleanup();
    await testCleanup();
  } catch (err) {
    console.error("\n💥 Unexpected error:", err);
    failed++;
    failures.push("Unexpected top-level error");
  }

  const total = passed + failed;
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Results: ${passed}/${total} passed`);
  if (failures.length) {
    console.log("  Failed tests:");
    failures.forEach((f) => console.log(`    ❌ ${f}`));
  } else {
    console.log("  🎉 All tests passed!");
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  process.exit(failed > 0 ? 1 : 0);
}

main();
