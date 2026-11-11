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
const noiseLines = (size) => Array.from({ length: size }, (_, index) => `${index + 1} noise 0.95`).join("\n");
const items = (count) => Array.from({ length: count }, (_, index) => ({ id: `task:${index + 1}`, projectId: 1, kind: "Comment", title: `HTPR-${index + 1}`, text: "Merged and deployed. All checks are green." }));
const runtime = ({ fundingSource = "managed", delayMs = 0, jevAnswer = noiseLines } = {}) => {
  const calls = [];
  let inFlight = 0;
  let peak = 0;
  const run = loadModule("src/lib/ai/jevInboxTriageRun.ts", {
    "@/lib/prisma": { default: { project: { findMany: async () => [{ id: 1, teamId: "team-1" }] }, team: { findFirst: async () => ({ id: "team-1" }) } } },
    "@/app/api/ai/_lib/byokKeys": { getTeamGatewayFunding: async () => (fundingSource === "none" ? undefined : { apiKey: "vck_fixture", source: fundingSource }) },
    "@/app/api/ai/_lib/modelProvider": { resolveGatewayModel: (slug) => ({ provider: "gateway", slug }), gatewayProviderOptionsForModel: () => undefined },
    ai: {
      generateText: async ({ model, prompt }) => {
        inFlight += 1; peak = Math.max(peak, inFlight); calls.push(model.slug);
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        inFlight -= 1;
        const size = (prompt.match(/^\d+\. /gm) || []).length;
        return { text: model.slug === pure.JEV_TRIAGE_MODEL_SLUG ? jevAnswer(size) : noiseLines(size) };
      },
    },
  });
  return { calls, run, peak: () => peak };
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

test("only noise at 0.9 or higher is suggested, and a garbled answer keeps", () => {
  const batch = [{ id: "task:1", projectId: 1, kind: "Comment", title: "HTPR-1", text: "" }];
  const select = (text) => pure.selectJevNoiseIds(pure.parseJevTriageBatch(text, batch));
  assert.deepEqual([select("1 noise 0.89"), select("1 needs_you 0.99"), select("1 maybe later"), select("")], [[], [], [], []]);
  assert.deepEqual([select("1 noise 0.9"), select("1) noise 95%")], [["task:1"], ["task:1"]]);
  const missing = pure.parseJevTriageBatch("1 noise 0.95", [...batch, { ...batch[0], id: "task:2" }]);
  assert.deepEqual([missing[1].needsYou, missing[1].confidence], [true, null]);
});

test("500 notifications clear in about a second", async () => {
  assert.deepEqual([pure.JEV_TRIAGE_BATCH_SIZE, pure.JEV_TRIAGE_CONCURRENCY, pure.JEV_TRIAGE_CALL_TIMEOUT_MS], [10, 8, 900]);
  assert.equal(pure.jevTriageBatches(items(500)).length, 50);
  const fake = runtime({ delayMs: 100 });
  const started = Date.now();
  const result = await fake.run.jevInboxTriage({ items: items(500), userId });
  const elapsed = Date.now() - started;
  assert.deepEqual([fake.calls.length, result.checked, result.noiseIds.length, fake.peak() <= 8, elapsed < 2000], [50, 500, 500, true, true], `500 notifications took ${elapsed} ms`);
});

test("Jev silent means the proven gateway model answers; a customer key means no call at all", async () => {
  const silent = runtime({ jevAnswer: () => "" });
  const result = await silent.run.jevInboxTriage({ items: items(2), userId });
  assert.deepEqual([...silent.calls, result.noiseIds.length], [pure.JEV_TRIAGE_MODEL_SLUG, "anthropic/claude-haiku-5.5", 2]);
  const customer = runtime({ fundingSource: "customer" });
  const none = runtime({ fundingSource: "none" });
  assert.deepEqual([
    (await customer.run.jevInboxTriage({ items: items(1), userId })).skipped,
    (await none.run.jevInboxTriage({ items: items(1), userId })).skipped,
    customer.calls.length + none.calls.length,
  ], ["customer_funding", "no_funding", 0]);
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
