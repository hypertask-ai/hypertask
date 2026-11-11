const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");
const rules = loadModule("src/lib/inbox/needsYou.ts");
const { getInboxTabs } = loadModule("src/utils/helperFunctions/inboxHelpers.ts");
const { groupInboxItemsByDate } = loadModule("src/lib/inbox/inboxDateGroups.ts");
const { buildInboxTasksPlaylist } = loadModule("src/lib/inbox/inboxTasksPlaylist.ts");
const notice = (extra = {}) => ({ id: 1, taskId: 1, userId: 985, type: "TaskMoved", projectId: 7049,
  task: { uniqueIndex: 1, title: "Routine move", waitingOnUserId: null }, project: { id: 7049, title: "QA" },
  createdAt: "2026-11-11T00:00:00Z", needsYouEnabled: true, ...extra });

test("rules cap boosts; highest distinct ticket wins, never date order", () => {
  assert.deepEqual(rules.needsYouRules(notice()), { score: 0, reason: "Update" });
  assert.equal(rules.needsYouRules(notice({ type: "Mentioned", comment: { kind: "question", text: "Pay?" }, task: { waitingOnUserId: 985, priority: { priority_index: 1 } } })).score, 20);
  const rows = [notice({ needsYouScore: 5 }), notice({ id: 2, needsYouScore: 95, createdAt: "2026-10-01T00:00:00Z" }), notice({ id: 3, taskId: 2, task: { uniqueIndex: 2 }, needsYouScore: 70 })];
  const tabs = getInboxTabs(rows);
  assert.deepEqual(tabs.data[tabs.tabs.findIndex(({ project }) => project === "Needs you")], [1, 2]);
  assert.equal(getInboxTabs(rows.map((row) => ({ ...row, needsYouEnabled: false }))).tabs.some(({ project }) => project === "Needs you"), false);
  assert.deepEqual(rules.needsYouIndices([notice({ needsYouSource: "skipped" }), notice({ taskId: null })]), []);
  assert.deepEqual(rules.needsYouIndices([undefined, ...rows]), [2, 3]);
  assert.doesNotThrow(() => getInboxTabs([undefined, ...rows]));
  const ranked = [rows[1], rows[2]].map((notification) => ({ notification, date: new Date(notification.createdAt) }));
  assert.deepEqual(groupInboxItemsByDate(ranked, false, null, true).ranked.items.map(({ notification }) => notification.id), [2, 3]);
  assert.deepEqual(buildInboxTasksPlaylist([rows[1], rows[2]], false).map(({ notification }) => notification.id), [2, 3]);
});

test("Jev converts a five-point score to 0-100 and stores cost; all failures return rules", async (t) => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "fixture-not-a-key";
  t.after(() => { if (previous === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous; });
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
  const allowed = worker();
  assert.equal((await Promise.all([allowed.run(985), allowed.run(985)])).reduce((a, b) => a + b), 1);
  assert.equal(allowed.row.needsYouScore, 95);
  assert.equal(allowed.paid(), 1);
  assert.equal(await allowed.run(985), 0);
  for (const options of [{ source: "customer" }, { plan: "BYOK" }, { settings: { ownKeyOnly: true } }, { providers: ["custom"] }, { ownKey: "customer-key" }, { access: false }]) {
    const skipped = worker(options);
    assert.equal(await skipped.run(985), 1);
    assert.equal(skipped.row.needsYouSource, "skipped");
    assert.equal(skipped.paid(), 0);
  }
  for (const settings of [{}, { providers: { openrouter: false } }]) {
    const disabled = worker({ settings });
    assert.equal(await disabled.run(985), 1);
    assert.equal(disabled.paid(), 0);
    assert.equal(disabled.row.needsYouSource, "rules");
  }
  const off = worker({ enabled: false });
  assert.equal(await off.run(985), 0);
  assert.equal(off.row.needsYouScoredAt, null);
});


test("catch-up route rejects unsigned calls and reports stored daily cost", async (t) => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "fixture-secret";
  t.after(() => { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; });
  const { GET } = loadModule("src/app/api/cron/needs-you/route.ts", {
    "@/lib/prisma": { default: { notification: { findMany: async () => [{ userId: 985 }], aggregate: async () => ({ _sum: { needsYouCostUsd: 0.00003 }, _count: { _all: 1, needsYouCostUsd: 1 } }) } } },
    "@/lib/flags": { featureFlagCandidateUserIds: async () => [985] },
    "@/utils/controllers/notifications/scoreNeedsYou": { scoreNeedsYouInbox: async () => 1 },
  });
  assert.equal((await GET({ headers: new Headers() })).status, 401);
  const response = await GET({ headers: new Headers({ authorization: "Bearer fixture-secret" }) });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual({ scored: result.scored, costUsd: result.costUsd }, { scored: 1, costUsd: 0.00003 });
});

test("inbox entry point keeps older scores through task collapse and never asks Jev on reads", async () => {
  const date = new Date();
  const rows = [notice({ needsYouScore: 5 }), notice({ id: 3, taskId: 2, needsYouScore: 70 })].map((row) => ({ ...row, needsYouEnabled: false, createdAt: date,
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
  assert.deepEqual(result.json.notifications.map(({ needsYouScore }) => needsYouScore), [95, 70]);
  const tab = result.json.structuredData.tabs.find(({ project }) => project === "Needs you");
  assert.deepEqual(result.json.structuredData.data[tab.idx], [0, 1]);
  enabled = false;
  const old = await entry("985");
  assert.equal(old.status, 200);
  assert.equal(old.json.structuredData.tabs.some(({ project }) => project === "Needs you"), false);
});
