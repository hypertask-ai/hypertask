const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NotificationType, Status } = require("@prisma/client");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const load = (file) => jiti(path.join(root, file));
const controller = load("src/utils/controllers/notifications/inboxZero.ts");
const pure = load("src/lib/ai/jevInboxTriage.ts");
const inboxZero = load("src/lib/inboxZero.ts");
const flag = load("src/lib/flags/definitions/htpr-9045-jev-inbox-triage.ts").default;
const corpus = require("./fixtures/htpr-9045/labelled-notifications.json");

const now = new Date("2026-11-10T12:00:00.000Z");
const userId = 42;
const keep = { unread: true, mentions: true, assignments: true };
const rules = (overrides = {}) => ({ ...inboxZero.DEFAULT_INBOX_ZERO_RULES, categories: { read: false, reactions: false, ownActions: false, superseded: false, pastReminders: false }, keep, ...overrides });
const row = (entry, index, extra = {}) => ({
  id: index + 1, notification_inviteId: null, type: NotificationType[entry.type], seen: true,
  createdAt: new Date("2026-11-01T10:00:00.000Z"), directReply: false, taskId: 9000 + index,
  fromUserId: entry.author === "human" ? 77 : null, fromAgentId: entry.author === "agent" ? "agent-1" : null,
  message: entry.message ?? null,
  comment: entry.type === "Comment" ? { text: entry.text, commentText: entry.text, kind: null, activity: null } : null,
  task: { status: Status.Normal, section: "Todo", projectId: 1, dueDate: null, title: entry.title, description: "", blockerCommentId: null, waitingOnUserId: null, _count: { assignees: 0, decisionRequests: 0, comments: 0 } },
  ...extra,
});
const rows = corpus.map(row);
const entryById = new Map(corpus.map((entry, index) => [index + 1, entry]));
const candidatesOf = (input = rows) => controller.jevTriageCandidates(input, userId, keep);
const noiseAnswers = (size) => ({ answers: Object.fromEntries(Array.from({ length: size }, (_, index) => [`item_${index}`, { type: "choice", choice: "noise", confidence: 0.95 }])) });
const items = (count) => Array.from({ length: count }, (_, index) => ({ id: `task:${index + 1}`, projectId: 1, kind: "Comment", title: `HTPR-${index + 1}`, text: "Merged and deployed. All checks are green." }));
const runtime = (t, { fundingSource = "managed", answer = noiseAnswers, status = 200, throws = false, plan = "Pro", settings = { providers: { openrouter: true } }, providers = [], providerKey } = {}) => {
  const calls = [];
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "fixture-openrouter";
  t.after(() => { if (previous === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous; });
  t.mock.method(global, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body, authorization: options.headers.Authorization, signal: options.signal });
    if (throws) throw new Error("provider unavailable");
    return Response.json(answer(Object.keys(body.questions).length), { status });
  });
  const run = loadModule("src/lib/ai/jevInboxTriageRun.ts", {
    "@/lib/prisma": { default: { project: { findMany: async () => [{ id: 1, teamId: "team-1" }] }, team: { findFirst: async () => ({ id: "team-1" }), findUnique: async () => ({ aiProviderSettings: settings, byokApiKeys: providers.map(provider => ({ provider })) }) } } },
    "@/app/api/ai/_lib/byokKeys": { getTeamGatewayFunding: async () => (fundingSource === "none" ? undefined : { apiKey: "vck_fixture", source: fundingSource }), isOurGatewayKey: key => key === "vck_fixture", resolveTeamByokApiKey: async () => providerKey },
    "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => plan },
  });
  return { calls, run };
};

test("300 labelled notifications: a hostile Jev that calls everything noise still proposes zero needs-you items", () => {
  assert.deepEqual([corpus.length, corpus.filter((entry) => entry.label === "needs_you").length], [300, 160]);
  const candidates = candidatesOf();
  assert.deepEqual(candidates.map((c) => entryById.get(c.notificationIds[0])).filter((entry) => entry.label === "needs_you"), []);
  const noise = new Set(pure.selectJevNoiseIds(candidates.map((c) => ({ id: c.item.id, needsYou: false, confidence: 0.99 }))));
  const ids = candidates.filter((c) => noise.has(c.key)).flatMap((c) => c.notificationIds);
  assert.ok(ids.length > 0 && ids.every((id) => entryById.get(id).label === "noise"));
  const result = controller.evaluateInboxZero(rows, userId, rules({ jevNotificationIds: ids }), now);
  assert.deepEqual(result.notificationIds.map((id) => entryById.get(id)).filter((entry) => entry.label === "needs_you"), []);
  assert.equal(result.jevNoiseCount, ids.length);
});

test("agent asks, money, access and agent-message bodies never reach Jev", () => {
  const message = (text, id) => row({ type: "AgentMessage", author: "agent", title: "Runner 3", text: "" }, id, { message: text });
  assert.deepEqual(candidatesOf([message("I need your approval to give Maria admin access before I continue.", 900)]), []);
  assert.equal(candidatesOf([message("Merge deployed. All production checks are green.", 901)]).length, 1);
});

test("structured decisions require confident noise; malformed and missing answers keep", () => {
  const batch = items(2);
  const select = (answer) => pure.selectJevNoiseIds(pure.parseJevTriageBatch({ answers: { item_0: answer } }, batch));
  for (const answer of [null, { type: "choice", choice: "noise" }, { type: "choice", choice: "noise", confidence: 1.1 }, { type: "choice", choice: "needs_you", confidence: 0.99 }, { type: "choice", choice: "noise", confidence: 0.89 }]) assert.deepEqual(select(answer), []);
  assert.deepEqual(select({ type: "choice", choice: "noise", confidence: 0.9 }), ["task:1"]);
  assert.deepEqual(pure.parseJevTriageBatch("1 noise 0.99", batch).map((v) => [v.needsYou, v.confidence]), [[true, null], [true, null]]);
  assert.deepEqual(pure.parseJevTriageBatch(noiseAnswers(1), batch)[1], { id: "task:2", needsYou: true, confidence: null });
});

test("500-item cap counts completed decisions, not merely attempted requests", async (t) => {
  const fake = runtime(t);
  const result = await fake.run.jevInboxTriage({ items: items(600), userId });
  assert.deepEqual([fake.calls.length, result.checked, result.noiseIds.length], [50, 500, 500]);
  for (const call of fake.calls) {
    assert.equal(call.url, "https://openrouter.ai/api/alpha/decisions");
    assert.equal(call.authorization, "Bearer fixture-openrouter");
    assert.equal(call.body.model, "typesafe/jev-1.14");
    assert.deepEqual(call.body.provider, { zdr: true, only: ["typesafe"], data_collection: "deny", allow_fallbacks: false });
    assert.equal(Object.keys(call.body.questions).length, 10);
    assert.equal(Object.keys(call.body.state).length, 10);
  }
});

for (const failure of [{ answer: () => ({}) }, { status: 503 }, { throws: true }]) {
  test(`Jev failure keeps everything without another model: ${JSON.stringify(failure)}`, async (t) => {
    const fake = runtime(t, failure);
    const result = await fake.run.jevInboxTriage({ items: items(2), userId });
    assert.deepEqual([fake.calls.length, result.checked, result.noiseIds], [1, 0, []]);
  });
}

for (const fundingSource of ["customer", "none", "missing_openrouter"]) {
  test(`${fundingSource} makes no provider call`, async (t) => {
    const fake = runtime(t, { fundingSource });
    if (fundingSource === "missing_openrouter") delete process.env.OPENROUTER_API_KEY;
    const result = await fake.run.jevInboxTriage({ items: items(1), userId });
    assert.equal(result.skipped, fundingSource === "customer" ? "customer_funding" : "no_funding");
    assert.equal(fake.calls.length, 0);
  });
}

for (const options of [{ plan: "BYOK" }, { settings: {} }, { settings: { providers: { openrouter: false } } }, { settings: { ownKeyOnly: true } }, { providers: ["anthropic"] }, { providerKey: "customer-key" }]) {
  test(`own AI accounts stay local: ${JSON.stringify(options)}`, async (t) => {
    const fake = runtime(t, options);
    assert.deepEqual(await fake.run.jevInboxTriage({ items: items(1), userId }), { noiseIds: [], checked: 0, skipped: "customer_funding" });
    assert.equal(fake.calls.length, 0);
  });
}

test("title-only questions, money and access stay even when a caller submits noise IDs", () => {
  const entry = { type: "TaskMoved", author: "agent", text: "", title: "Moved to Todo" };
  for (const title of ["Can you check this?", "Approve the invoice", "Restore admin access", `A note for name-${userId}`]) {
    const notice = row({ ...entry, title }, 700);
    assert.deepEqual(candidatesOf([notice]), [], title);
    assert.deepEqual(controller.evaluateInboxZero([notice], userId, rules({ jevNotificationIds: [notice.id] }), now).notificationIds, [], title);
  }
  const notice = row(entry, 701);
  assert.equal(candidatesOf([notice]).length, 1);
  assert.deepEqual(controller.evaluateInboxZero([notice], userId, rules({ jevNotificationIds: [notice.id] }), now).notificationIds, [notice.id]);
});

test("the preview hash repeats, the engine re-guards, and the flag ships at Owner and QA", () => {
  const noiseId = corpus.findIndex((entry) => entry.label === "noise" && entry.author === "agent") + 1;
  const questionId = corpus.findIndex((entry) => entry.label === "needs_you") + 1;
  const hash = (list) => controller.evaluateInboxZero(rows, userId, rules({ jevNotificationIds: list }), now).previewVersion;
  assert.deepEqual([hash([noiseId]), hash([noiseId]) !== hash([])], [hash([noiseId]), true]);
  assert.deepEqual(controller.evaluateInboxZero(rows, userId, rules({ jevNotificationIds: [noiseId, questionId] }), now).notificationIds, [noiseId]);
  assert.deepEqual(controller.evaluateInboxZero(rows, userId, controller.withoutJevTriage(rules({ jevNotificationIds: [noiseId] })), now).notificationIds, []);
  assert.deepEqual(controller.parseInboxZeroRules({ ...inboxZero.DEFAULT_INBOX_ZERO_RULES, jevNotificationIds: [1] }).jevNotificationIds, [1]);
  assert.equal(controller.parseInboxZeroRules({ ...inboxZero.DEFAULT_INBOX_ZERO_RULES, jevNotificationIds: ["x"] }), null);
  assert.deepEqual([flag.key, flag.kind, flag.defaultMode], ["htpr-9045-jev-inbox-triage", "feature", "OWNER_AND_QA"]);
});
