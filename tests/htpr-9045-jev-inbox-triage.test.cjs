const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NotificationType, Status } = require("@prisma/client");

const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const jitiModule = (file) => jiti(path.join(root, file));

const controller = jitiModule("src/utils/controllers/notifications/inboxZero.ts");
const pure = jitiModule("src/lib/ai/jevInboxTriage.ts");
const inboxZero = jitiModule("src/lib/inboxZero.ts");
const flag = jitiModule("src/lib/flags/definitions/htpr-9045-jev-inbox-triage.ts").default;
const corpus = require("./fixtures/htpr-9045/labelled-notifications.json");

const now = new Date("2026-11-10T12:00:00.000Z");
const userId = 42;

const rules = (overrides = {}) => ({
  threshold: 7,
  categories: {
    read: false,
    reactions: false,
    ownActions: false,
    superseded: false,
    pastReminders: false,
    jevNoise: true,
  },
  keep: { unread: true, mentions: true, assignments: true },
  ...overrides,
});

const notificationRow = (entry, index) => ({
  id: index + 1,
  notification_inviteId: null,
  type: NotificationType[entry.type],
  seen: true,
  createdAt: new Date("2026-11-01T10:00:00.000Z"),
  fromUserId: entry.author === "human" ? 77 : null,
  fromAgentId: entry.author === "agent" ? "agent-1" : null,
  directReply: false,
  taskId: 9000 + index,
  comment:
    entry.type === "Comment" || entry.type === "AgentMessage"
      ? { text: entry.text, commentText: entry.text, kind: null, activity: null }
      : null,
  task: {
    status: Status.Normal,
    section: "Todo",
    projectId: 1,
    dueDate: null,
    title: entry.title,
    description: "",
    blockerCommentId: null,
    waitingOnUserId: null,
    _count: { assignees: 0, decisionRequests: 0, comments: 0 },
  },
});

const corpusRows = corpus.map(notificationRow);
const corpusById = new Map(corpus.map((entry, index) => [index + 1, entry]));

function hostileSelection(rows) {
  const candidates = controller.jevTriageCandidates(rows, userId, rules().keep);
  const noiseIds = pure.selectJevNoiseIds(
    candidates.map((candidate) => ({
      id: candidate.item.id,
      needsYou: false,
      confidence: 0.99,
    }))
  );
  const noise = new Set(noiseIds);
  return {
    candidates,
    notificationIds: candidates
      .filter((candidate) => noise.has(candidate.key))
      .flatMap((candidate) => candidate.notificationIds),
  };
}

const triageRuntime = (options = {}) => {
  const calls = [];
  let inFlight = 0;
  let peak = 0;
  const {
    fundingSource = "managed",
    answerFor = (batchSize) =>
      Array.from({ length: batchSize }, (_, index) => `${index + 1} noise 0.95`).join("\n"),
    delayMs = 0,
  } = options;
  const run = loadModule("src/lib/ai/jevInboxTriageRun.ts", {
    "@/lib/prisma": { default: { team: { findFirst: async () => ({ id: "team-1" }) } } },
    "@/app/api/ai/_lib/byokKeys": {
      getTeamGatewayFunding: async () =>
        fundingSource === "none" ? undefined : { apiKey: "vck_fixture", source: fundingSource },
    },
    "@/app/api/ai/_lib/modelProvider": {
      resolveGatewayModel: () => ({ provider: "gateway" }),
      gatewayProviderOptionsForModel: () => undefined,
    },
    ai: {
      generateText: async ({ prompt }) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        calls.push(prompt);
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        const batchSize = Number((prompt.match(/^\d+\. /gm) || []).length);
        inFlight -= 1;
        return { text: answerFor(batchSize) };
      },
    },
  });
  return { calls, run, peak: () => peak };
};

test("the corpus is 300 labelled notifications with both labels", () => {
  assert.equal(corpus.length, 300);
  assert.equal(corpus.filter((entry) => entry.label === "needs_you").length, 160);
  assert.equal(corpus.filter((entry) => entry.label === "noise").length, 140);
  assert.equal(new Set(corpus.map((entry) => entry.id)).size, 300);
});

test("zero real questions are suggested, even when Jev calls everything noise", () => {
  const selected = hostileSelection(corpusRows);
  const suggested = selected.notificationIds.map((id) => corpusById.get(id));
  const wrong = suggested.filter((entry) => entry.label === "needs_you");
  assert.deepEqual(
    wrong.map((entry) => entry.id),
    [],
    "zero needs-you notifications may be proposed for archive"
  );
  assert.ok(suggested.length > 0, "the noise notifications are still proposed");
  assert.ok(
    suggested.every((entry) => entry.label === "noise"),
    "every suggestion is a labelled noise notification"
  );

  const result = controller.evaluateInboxZero(
    corpusRows,
    userId,
    rules({ jevNotificationIds: selected.notificationIds }),
    now
  );
  const archived = result.notificationIds.map((id) => corpusById.get(id));
  assert.deepEqual(archived.filter((entry) => entry.label === "needs_you"), []);
  assert.equal(result.jevNoiseCount, selected.notificationIds.length);
});

test("agent questions, money, access and replies stay out of the candidate list", () => {
  const candidates = controller.jevTriageCandidates(corpusRows, userId, rules().keep);
  const asked = candidates
    .map((candidate) => corpusById.get(candidate.notificationIds[0]))
    .filter((entry) => entry.label === "needs_you");
  assert.deepEqual(asked, []);
});

test("only noise at 0.9 or higher is suggested", () => {
  const items = [{ id: "task:1", kind: "Comment", title: "HTPR-1", text: "" }];
  const verdict = (text) => pure.parseJevTriageBatch(text, items);
  assert.deepEqual(pure.selectJevNoiseIds(verdict("1 noise 0.89")), []);
  assert.deepEqual(pure.selectJevNoiseIds(verdict("1 noise 0.9")), ["task:1"]);
  assert.deepEqual(pure.selectJevNoiseIds(verdict("1. noise 95%")), ["task:1"]);
  assert.deepEqual(pure.selectJevNoiseIds(verdict("1) noise 0.95")), ["task:1"]);
  assert.deepEqual(pure.selectJevNoiseIds(verdict("1 needs_you 0.95")), []);
  assert.deepEqual(pure.selectJevNoiseIds(verdict("")), []);
  assert.deepEqual(pure.selectJevNoiseIds(verdict("1 maybe later")), []);
  assert.deepEqual(pure.selectJevNoiseIds(verdict("1 noise 100%")), ["task:1"]);
});

test("a missing, short or garbled answer keeps the notification", () => {
  const items = [
    { id: "task:1", kind: "Comment", title: "HTPR-1", text: "" },
    { id: "task:2", kind: "Comment", title: "HTPR-2", text: "" },
    { id: "task:3", kind: "Comment", title: "HTPR-3", text: "" },
  ];
  const verdicts = pure.parseJevTriageBatch("1 noise 0.95\n2 needs_you 0.8", items);
  assert.deepEqual(pure.selectJevNoiseIds(verdicts), ["task:1"]);
  assert.equal(verdicts[2].needsYou, true);
  assert.equal(verdicts[2].confidence, null);
});

test("500 notifications sort in about a second and reuse the batch size", async () => {
  assert.equal(pure.JEV_TRIAGE_BATCH_SIZE, 10);
  assert.equal(pure.JEV_TRIAGE_CONCURRENCY, 8);
  assert.equal(pure.JEV_TRIAGE_CALL_TIMEOUT_MS, 900);
  assert.equal(pure.JEV_TRIAGE_MIN_CONFIDENCE, 0.9);
  assert.equal(pure.JEV_TRIAGE_MODEL_SLUG, "openrouter/jev");

  const items = Array.from({ length: 500 }, (_, index) => ({
    id: `task:${index + 1}`,
    kind: "Comment",
    title: `HTPR-${index + 1}`,
    text: "Merged and deployed. Production checks are all green.",
  }));
  assert.equal(pure.jevTriageBatches(items).length, 50);

  const runtime = triageRuntime({ delayMs: 100 });
  const started = Date.now();
  const result = await runtime.run.jevInboxTriage({ items, teamId: "team-1", userId });
  const elapsed = Date.now() - started;

  assert.equal(runtime.calls.length, 50);
  assert.equal(result.checked, 500);
  assert.equal(result.noiseIds.length, 500);
  assert.ok(runtime.peak() <= 8, `at most 8 calls in flight, saw ${runtime.peak()}`);
  assert.ok(elapsed < 2000, `500 notifications took ${elapsed} ms`);
});

test("a team that brings its own key is skipped with no Jev call", async () => {
  const runtime = triageRuntime({ fundingSource: "customer" });
  const result = await runtime.run.jevInboxTriage({
    items: [{ id: "task:1", kind: "Comment", title: "HTPR-1", text: "hello" }],
    teamId: "team-1",
    userId,
  });
  assert.deepEqual(result, { noiseIds: [], checked: 0, skipped: "customer_funding" });
  assert.equal(runtime.calls.length, 0);
});

test("no team or no funding means no call and no suggestion", async () => {
  const noTeam = triageRuntime();
  assert.deepEqual(
    await noTeam.run.jevInboxTriage({
      items: [{ id: "task:1", kind: "Comment", title: "HTPR-1", text: "hello" }],
      teamId: null,
      userId,
    }),
    { noiseIds: [], checked: 0, skipped: "no_team" }
  );
  const noFunding = triageRuntime({ fundingSource: "none" });
  assert.deepEqual(
    await noFunding.run.jevInboxTriage({
      items: [{ id: "task:1", kind: "Comment", title: "HTPR-1", text: "hello" }],
      teamId: "team-1",
      userId,
    }),
    { noiseIds: [], checked: 0, skipped: "no_funding" }
  );
  assert.equal(noTeam.calls.length + noFunding.calls.length, 0);
});

test("the preview hash repeats for the same ids and changes when they change", () => {
  const selected = hostileSelection(corpusRows);
  const withIds = rules({ jevNotificationIds: selected.notificationIds.slice(0, 20) });
  const first = controller.evaluateInboxZero(corpusRows, userId, withIds, now);
  const again = controller.evaluateInboxZero(corpusRows, userId, withIds, now);
  const fewer = controller.evaluateInboxZero(
    corpusRows,
    userId,
    rules({ jevNotificationIds: selected.notificationIds.slice(0, 10) }),
    now
  );
  assert.equal(first.previewVersion.length, 64);
  assert.equal(first.previewVersion, again.previewVersion);
  assert.notEqual(first.previewVersion, fewer.previewVersion);
});

test("the engine ignores a jev id when the category is off or the guard fails", () => {
  const noiseId =
    corpus.findIndex((entry) => entry.label === "noise" && entry.author === "agent") + 1;
  const questionId = corpus.findIndex((entry) => entry.label === "needs_you") + 1;
  const off = controller.evaluateInboxZero(
    corpusRows,
    userId,
    rules({
      categories: { ...rules().categories, jevNoise: false },
      jevNotificationIds: [noiseId, questionId],
    }),
    now
  );
  assert.deepEqual(off.notificationIds, []);

  const on = controller.evaluateInboxZero(
    corpusRows,
    userId,
    rules({ jevNotificationIds: [noiseId, questionId] }),
    now
  );
  assert.deepEqual(on.notificationIds, [noiseId]);
});

test("existing rules payloads without the Jev switch still parse", () => {
  const legacy = controller.parseInboxZeroRules({
    threshold: 7,
    categories: {
      read: true,
      reactions: true,
      ownActions: true,
      superseded: true,
      pastReminders: true,
    },
    keep: { unread: true, mentions: true, assignments: true },
  });
  assert.ok(legacy);
  assert.equal(legacy.categories.jevNoise, undefined);
  assert.ok(controller.parseInboxZeroRules(inboxZero.DEFAULT_INBOX_ZERO_RULES));

  const withJev = controller.parseInboxZeroRules({
    ...inboxZero.DEFAULT_INBOX_ZERO_RULES,
    categories: { ...inboxZero.DEFAULT_INBOX_ZERO_RULES.categories, jevNoise: true },
    jevNotificationIds: [1, 2, 3],
  });
  assert.equal(withJev.categories.jevNoise, true);
  assert.deepEqual(withJev.jevNotificationIds, [1, 2, 3]);
  assert.equal(
    controller.parseInboxZeroRules({ ...inboxZero.DEFAULT_INBOX_ZERO_RULES, jevNotificationIds: ["x"] }),
    null
  );
});

test("the flag ships at Owner and QA, never Everyone", () => {
  assert.equal(flag.key, "htpr-9045-jev-inbox-triage");
  assert.equal(flag.kind, "feature");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
});
