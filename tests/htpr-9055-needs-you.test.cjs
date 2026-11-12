const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");
const rules = loadModule("src/lib/inbox/needsYou.ts");
const { getInboxTabs } = loadModule("src/utils/helperFunctions/inboxHelpers.ts");
const { groupInboxItemsByDate } = loadModule("src/lib/inbox/inboxDateGroups.ts");
const { buildInboxTasksPlaylist } = loadModule("src/lib/inbox/inboxTasksPlaylist.ts");
const originalEnv = process.env;
process.env = { ...originalEnv, OPENROUTER_API_KEY: "fixture-not-a-key", CRON_SECRET: "fixture-secret" };
test.after(() => { process.env = originalEnv; });
const notice = (extra = {}) => ({ id: 1, taskId: 1, userId: 985, type: "TaskMoved", projectId: 7049,
  task: { uniqueIndex: 1, title: "Routine move", waitingOnUserId: null }, project: { id: 7049, title: "QA" },
  createdAt: "2026-11-11T00:00:00Z", needsYouEnabled: true, ...extra });

test("rules cap boosts; actionable distinct tickets keep model ranking, never date order", () => {
  assert.deepEqual(rules.needsYouRules(notice()), { score: 0, reason: "Update" });
  assert.equal(rules.needsYouRules(notice({ type: "Mentioned", comment: { kind: "question", text: "Pay?" }, task: { waitingOnUserId: 985, priority: { priority_index: 1 } } })).score, 20);
  const rows = [notice({ type: "Mentioned", needsYouSource: "jev", needsYouScore: 5 }), notice({ id: 2, type: "Mentioned", needsYouSource: "jev", needsYouScore: 95, createdAt: "2026-10-01T00:00:00Z" }), notice({ id: 3, type: "Mentioned", taskId: 2, task: { uniqueIndex: 2 }, needsYouSource: "jev", needsYouScore: 70 })];
  const tabs = getInboxTabs(rows);
  assert.deepEqual(tabs.data[tabs.tabs.findIndex(({ project }) => project === "Needs you")], [1, 2]);
  assert.equal(getInboxTabs(rows.map((row) => ({ ...row, needsYouEnabled: false }))).tabs.some(({ project }) => project === "Needs you"), false);
  assert.deepEqual(rules.needsYouIndices([notice({ needsYouSource: "skipped" }), notice({ taskId: null })]), []);
  assert.equal(getInboxTabs([notice({ needsYouSource: "skipped" })]).tabs.some(({ project }) => project === "Needs you"), false);
  assert.deepEqual(rules.needsYouIndices([undefined, ...rows]), [2, 3]);
  assert.doesNotThrow(() => getInboxTabs([undefined, ...rows]));
  const ranked = [rows[1], rows[2]].map((notification) => ({ notification, date: new Date(notification.createdAt) }));
  assert.deepEqual(groupInboxItemsByDate(ranked, false, null, true).ranked.items.map(({ notification }) => notification.id), [2, 3]);
  assert.deepEqual(buildInboxTasksPlaylist([rows[1], rows[2]], false).map(({ notification }) => notification.id), [2, 3]);
});

test("Jev converts a five-point score to 0-100 and stores cost; all failures return rules", async (t) => {
  const { needsYouScore } = loadModule("src/lib/ai/needsYouScore.ts");
  let sent;
  t.mock.method(global, "fetch", async (_url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ answers: { urgency: { type: "score", score: 3.8 }, kind: { type: "choice", choice: "decision" } }, usage: { cost: 0.00003 } }) };
  });
  assert.deepEqual(await needsYouScore(notice()), { needsYouScore: 95, needsYouReason: "Needs your decision; Update", needsYouSource: "jev", needsYouCostUsd: 0.00003 });
  assert.deepEqual(sent.provider, { zdr: true, only: ["typesafe"], data_collection: "deny" });
  assert.equal(sent.model, "typesafe/jev-1.14");
  for (const response of [{ ok: false }, { ok: true, json: async () => ({ answers: { urgency: { type: "score", score: 999 } } }) }]) {
    global.fetch = async () => response;
    assert.equal((await needsYouScore(notice({ type: "Mentioned" }))).needsYouScore, 5);
  }
  global.fetch = async () => { throw new Error("offline"); };
  assert.equal((await needsYouScore(notice())).needsYouSource, "rules");
  global.fetch = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  const keepAlive = setTimeout(() => {}, 4500);
  try { assert.equal((await needsYouScore(notice())).needsYouSource, "rules"); } finally { clearTimeout(keepAlive); }
});

function worker({ enabled = true, source = "managed", plan = "Pro", settings = { providers: { openrouter: true } }, providers = [], access = true, ownKey } = {}) {
  const row = notice({ needsYouScoredAt: null, project: { teamId: "team", team: { aiProviderSettings: settings, byokApiKeys: providers.map((provider) => ({ provider })) } } });
  let paid = 0;
  const database = { notification: {
    findMany: async () => row.needsYouScoredAt ? [] : [row],
    updateMany: async ({ data }) => { if (row.needsYouScoredAt) return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
    update: async ({ data }) => Object.assign(row, data),
  } };
  const run = loadModule("src/utils/controllers/notifications/scoreNeedsYou.ts", {
    "@/lib/prisma": { default: database }, "@/lib/flags": { isFeatureEnabled: async () => enabled },
    "@/app/api/ai/_lib/byokKeys": { getTeamGatewayFunding: async () => ({ source }), resolveTeamByokApiKey: async () => ownKey, isOurGatewayKey: () => false },
    "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => plan },
    "@/lib/access/canReadTaskNow": { canReadTaskNow: async () => access },
    "@/lib/ai/needsYouScore": { needsYouScore: async () => { paid++; return { needsYouScore: 95, needsYouReason: "Needs your decision", needsYouSource: "jev", needsYouCostUsd: 0.00003 }; } },
  }).scoreNeedsYouInbox;
  return { run, row, paid: () => paid };
}

test("arrival retries and concurrent delivery score once; own-AI teams and revoked access send nothing", async () => {
  for (const [options, source, paid, score] of [
    [{}, "jev", 1, 95], [{ source: "customer" }, "skipped", 0, 0], [{ plan: "BYOK" }, "skipped", 0, 0],
    [{ settings: { ownKeyOnly: true } }, "skipped", 0, 0], [{ providers: ["custom"] }, "rules", 0, 0],
    [{ ownKey: "customer-key" }, "skipped", 0, 0], [{ access: false }, "skipped", 0, 0],
    [{ settings: {} }, "rules", 0, 0], [{ settings: { providers: { openrouter: false } } }, "rules", 0, 0],
    [{ enabled: false }, undefined, 0, null],
  ]) {
    const { run, row, paid: calls } = worker(options);
    assert.equal((await Promise.all([run(985), run(985)])).reduce((a, b) => a + b), options.enabled === false ? 0 : 1);
    assert.deepEqual([row.needsYouSource, calls(), row.needsYouScore ?? null], [source, paid, score]);
    assert.equal(await run(985), 0);
    if (options.enabled === false) assert.equal(row.needsYouScoredAt, null);
  }
});

test("catch-up route rejects unsigned calls and scores without a daily scan", async () => {
  const { GET } = loadModule("src/app/api/cron/needs-you/route.ts", {
    "@/lib/prisma": { default: { notification: { findMany: async () => [{ userId: 985 }] } } },
    "@/lib/flags": { featureFlagCandidateUserIds: async () => [985] },
    "@/utils/controllers/notifications/scoreNeedsYou": { scoreNeedsYouInbox: async () => 1 },
  });
  assert.equal((await GET({ headers: new Headers() })).status, 401);
  const response = await GET({ headers: new Headers({ authorization: "Bearer fixture-secret" }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { scored: 1 });
});

test("inbox entry point keeps each displayed notice score and never asks Jev on reads", async () => {
  const date = new Date();
  const rows = [notice({ type: "Mentioned", needsYouSource: "jev", needsYouScore: 5 }), notice({ id: 3, type: "Mentioned", needsYouSource: "jev", taskId: 2, needsYouScore: 70 })].map((row) => ({ ...row, needsYouEnabled: false, createdAt: date,
    task: { ...row.task, sectionChangedAt: date, createdAt: date, lastCommentAt: date, assignees: [] } }));
  let enabled = true;
  const database = { $queryRaw: async (query) => query.sql.includes("AS selected") ? [{ id: 1, needsYouScore: 95 }, { id: 3, needsYouScore: 70 }] : [],
    notification: { findMany: async ({ where }) => where.AND?.some((clause) => clause.id) ? rows : [], groupBy: async () => [] },
    task: { findMany: async () => [] }, userSetting: { findUnique: async () => null }, taskReadState: { findMany: async () => [] }, comment: { groupBy: async () => [] } };
  const entry = loadModule("src/utils/controllers/notifications/getAll.ts", {
    "@/lib/prisma": { default: database }, "@/lib/flags": { isFeatureEnabled: async (key) => enabled && key === "htpr-9055-needs-you" },
    "@/utils/controllers/notifications/quietOwnerInbox": { markQuietAgentMentions: async (_db, _userId, notices) => notices },
    "@/lib/ai/needsYouScore": { needsYouScore: () => { throw new Error("inbox reads must not call models"); } },
  }).default;
  const result = await entry("985");
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.notifications.map(({ needsYouScore }) => needsYouScore), [5, 70]);
  const tab = result.json.structuredData.tabs.find(({ project }) => project === "Needs you");
  assert.deepEqual(result.json.structuredData.data[tab.idx], [1, 0]);
  enabled = false;
  const old = await entry("985");
  assert.equal(old.status, 200);
  assert.equal(old.json.structuredData.tabs.some(({ project }) => project === "Needs you"), false);
});

test("current recipient blocks beat every model score; noise and resolved blocks are excluded", () => {
  const rows = [
    notice({ needsYouSource: "jev", needsYouScore: 100, fromAgentId: "runner", task: { title: "Urgent access payment?", priority: { priority_index: 1 } } }),
    notice({ taskId: 2, type: "Mentioned", needsYouSource: "jev", needsYouScore: 100 }),
    notice({ taskId: 3, needsYouSource: "rules", needsYouScore: 0, task: { waitingOnUserId: 985 } }),
    notice({ taskId: 4, needsYouSource: "rules", needsYouScore: 20, task: { waitingOnUserId: 42 } }),
    notice({ taskId: 5, task: { waitingOnUserId: 985, waitingOnAgentId: "runner" } }),
    notice({ taskId: 6, task: { waitingOnUserId: 985, section: "Done" } }),
    notice({ taskId: 7, type: "Mentioned", task: { status: "Archive" } }),
    notice({ taskId: 8, type: "Comment", fromAgentId: "runner", comment: { text: "Question: pay now?", kind: "question" } }),
  ];
  assert.deepEqual(rules.needsYouIndices(rows), [2, 1]);
  rows[2].task.waitingOnUserId = null;
  assert.deepEqual(rules.needsYouIndices(rows), [1]);
  assert.equal(rules.needsYouRules(rows[0]).reason, "Urgent");
});

test("routine-only inbox keeps its normal default split instead of an empty Needs you", () => {
  const rows = [notice({ needsYouSource: "rules", needsYouScore: 0 })];
  const { tabs, data } = getInboxTabs(rows);
  assert.equal(tabs.some(({ project }) => project === "Needs you"), false);
  assert.ok(data[tabs[0].idx].includes(0));
});

test("addressed agent questions earn a place, but answered questions and bot status mentions do not", () => {
  const rows = [
    notice({ type: "Mentioned", fromAgentId: "runner", comment: { text: "Status: shipped", kind: "done" }, needsYouScore: 100, needsYouSource: "jev" }),
    notice({ taskId: 2, type: "Mentioned", fromAgentId: "runner", comment: { text: "<p><strong>Question:</strong> pay now?</p>", kind: "question" } }),
    notice({ taskId: 3, type: "Mentioned", fromAgentId: "runner", quietImportant: true, comment: { text: "Question: old request?", kind: "question" } }),
    notice({ taskId: 4, isDecision: true, type: "TaskMoved", fromAgentId: "runner" }),
    notice({ taskId: 5, type: "Comment", fromAgentId: "runner", comment: { kind: "question", text: "Please choose" }, task: { assignees: [{ userId: 985, agentId: null }] } }),
    notice({ taskId: 6, type: "Comment", fromAgentId: "runner", comment: { kind: "question", text: "Please choose" }, task: { assignees: [{ userId: 985, agentId: "runner" }] } }),
  ];
  assert.deepEqual(rules.needsYouIndices(rows), [1, 4, 3]);
  assert.match(rules.needsYouRules(rows[1]).reason, /Question/);
});

test("thirty dismissed current blockers stay in Needs you, not ordinary inbox tabs, ahead of sixteen noise rows", async () => {
  const date = new Date("2026-11-12T03:00:00Z");
  const project = { id: 7049, title: "QA", teamId: "team" };
  const waiting = Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, uniqueIndex: 100 + i, projectId: 7049, project,
    title: `Decision ${i}`, status: "Normal", section: "Valentin Review", createdAt: date, sectionChangedAt: date,
    waitingOnUserId: 985, waitingOnAgentId: null, waitingOnSetAt: date, waitingOnSetById: null,
    user: { id: 99, displayName: "Requester" }, notifications: [{ archivedAt: date }],
  }));
  waiting.push({ ...waiting[0], id: 500, notifications: [{ archivedAt: date, needsYouSource: "skipped" }] });
  const noise = Array.from({ length: 16 }, (_, i) => notice({ id: i + 1, taskId: i + 1, project, fromAgentId: "runner",
    createdAt: date, needsYouSource: "rules", needsYouScore: i % 2 ? 3 : 0,
    task: { title: "Access key status", section: "Backlog", status: "Normal", priority: { priority_index: 1 },
      waitingOnUserId: null, sectionChangedAt: date, createdAt: date, assignees: [] },
  }));
  let enabled = true;
  const database = { $queryRaw: async (query) => query.sql.includes("AS selected") ? noise.map(({ id }) => ({ id })) : [],
    notification: { findMany: async ({ where }) => where.AND?.some((clause) => clause.id) ? noise : [], groupBy: async () => [] },
    task: { findMany: async () => waiting }, userSetting: { findUnique: async () => null },
    agent: { findMany: async () => [{ id: "runner", permissions: { postsToImportant: false } }] },
    user: { findMany: async () => [] },
    taskReadState: { findMany: async () => [] }, comment: { groupBy: async () => [] } };
  const entry = loadModule("src/utils/controllers/notifications/getAll.ts", {
    "@/lib/prisma": { default: database },
    "@/lib/flags": { isFeatureEnabled: async (key) => key === "htpr-7840-blocked-inbox-archive" || (enabled && key === "htpr-9055-needs-you") },
    "@/utils/controllers/notifications/quietOwnerInbox": { markQuietAgentMentions: async (_db, _userId, rows) => rows },
  }).default;
  const result = await entry("985");
  assert.equal(result.status, 200);
  const { tabs, data } = result.json.structuredData;
  const tab = tabs.find(({ project }) => project === "Needs you");
  assert.equal(tab.length, 30);
  assert.deepEqual(data[tab.idx].map(i => result.json.notifications[i].taskId), waiting.slice(0, 30).map(({ id }) => id));
  assert.equal(tabs.some(({ project }) => project === "Blocked by you"), false);
  assert.equal(data[tabs.find(({ project }) => project === "All").idx].length, 16);
  enabled = false;
  const old = await entry("985");
  assert.equal(old.status, 200);
  assert.equal(old.json.notifications.length, 16);
  assert.equal(old.json.structuredData.tabs.some(({ project }) => project === "Needs you"), false);
});
