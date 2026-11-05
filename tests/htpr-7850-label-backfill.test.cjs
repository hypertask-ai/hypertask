const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { createHash } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const output = load(path.join(root, "src/lib/ai/labelClassifierOutput.ts"));

function fixture({ matches = true, batch = false, flag = true } = {}) {
  const records = new Map();
  const labels = new Set();
  const usage = [];
  const pending = [];
  const errors = [];
  let failure = false;
  let malformed = false;
  let stale = false;
  let submittedBatch;
  const task = { id: 91, projectId: 7283, title: "Broken button", description: "Cannot click", userId: 985,
    agentId: null, updatedAt: new Date("2026-10-27T14:00:00Z"), description_: null, project: { teamId: "qa-team" } };
  const label = { id: "bug", ai_prompt: "Broken features", projectId: 7283 };
  const taskLabel = {
    findMany: async ({ where }) => [...labels].filter(id => (!where.labelId || (typeof where.labelId === "string" ? where.labelId === id : where.labelId.in.includes(id))))
      .map(labelId => ({ taskId: task.id, labelId, label: { id: labelId, value: labelId } })),
    upsert: async ({ create }) => { labels.add(create.labelId); return { ...create, label: { id: create.labelId, value: create.labelId } }; },
    deleteMany: async ({ where }) => labels.delete(where.labelId),
  };
  const classification = {
    findMany: async () => [...records.values()],
    upsert: async ({ create, update, where }) => {
      const key = `${where.taskId_labelId.taskId}:${where.taskId_labelId.labelId}`;
      records.set(key, records.has(key) ? { ...records.get(key), ...update } : create);
    },
  };
  const prisma = {
    label: { findUnique: async () => label, findMany: async () => [{ ...label }] },
    task: { findFirst: async () => task, findMany: async () => [{ ...task }], findUnique: async () => task },
    aiLabelClassification: classification,
    user: { findUnique: async () => ({ id: 100, displayName: "HyperAI" }) },
    taskLabel,
    aiBatch: { findMany: async () => submittedBatch ? [submittedBatch] : [], update: async () => {}, updateMany: async () => ({ count: 1 }) },
    slackWatchedThread: { findMany: async () => [] },
    $transaction: async work => work({ $queryRaw: async (parts) => parts.join("").includes('FROM "Label"') ? [{ ai_prompt: label.ai_prompt }] : stale ? [] : [{ id: task.id }], task: prisma.task, taskLabel, aiLabelClassification: classification }),
  };
  const stubs = {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/net/downloadWithoutBrotli": {},
    "@/app/api/ai/_lib/planAllowancePolicy": { teamPlanAllowanceEnabled: async () => true },
    "@/app/api/ai/_lib/byokKeys": { getTeamGatewayApiKey: async () => "vck_fixture", resolveAutomaticAiModel: () => ({}) },
    "@/app/api/ai/_lib/planGate": { haikuDefaultModelEnabled: async () => false, batchBackgroundAiEnabled: async () => batch },
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {}, resolveGatewayModel: () => ({}), gatewayProviderOptionsForModel: () => ({}), gatewayFundingSourceForApiKey: () => "gateway" },
    "@/app/api/ai/_lib/sharedAllowance": { gatewayCatalogModelSlug: value => value },
    "@/app/api/ai/_lib/allowanceError": { findSharedAiAllowanceError: () => undefined },
    "@/app/api/ai/_lib/taskContent": { convertHtmlToText: value => value },
    "@/lib/ai/batch/batchJobs": {
      batchEligibleFunding: () => true, batchEligibleModel: () => true,
      labelTaskContentHash: task => createHash("sha256").update(JSON.stringify([task.title, task.description])).digest("hex"),
    },
    "@/lib/ai/labelClassifierBatch": { submitSmartLabelBatch: async args => { pending.push(args); } },
    "@/lib/configs/general.config": { generalConfig: { hyperAiId: 100 } },
    "@/lib/ai/labelClassifierOutput": output,
    "@/lib/realtime/server": { broadcastBoardChange: async () => {} },
    "@/lib/agentWebhooks/outbox": { persistAgentTaskUpdatedWebhook: async () => [], publishAgentWebhookDeliveries: async () => {} },
    "@/utils/controllers/activities/createLabelActivity": { __esModule: true, default: async () => {} },
    "@/lib/flags": { isFeatureEnabled: async key => {
      if (key === "htpr-7850-label-backfill-skip-unchanged") { if (flag === "unavailable") throw new Error("Flag store unavailable"); return flag; }
      if (key === "yper4-915-error-log-never-bug" || key === "htpr-8099-smart-label-refusal") return true;
      throw new Error(`Unexpected flag: ${key}`);
    } },
    "@/lib/flags/definitions/htpr-8099-smart-label-refusal": { HTPR_8099_SMART_LABEL_REFUSAL_FLAG: "htpr-8099-smart-label-refusal" },
    "@/lib/flags/definitions/htpr-7850-label-backfill-skip-unchanged": { HTPR_7850_LABEL_BACKFILL_SKIP_UNCHANGED_FLAG: "htpr-7850-label-backfill-skip-unchanged" },
    "@/lib/flags/definitions/yper4-915-error-log-never-bug": { YPER4_915_ERROR_LOG_NEVER_BUG_FLAG: "yper4-915-error-log-never-bug" },
    "@vercel/functions": { waitUntil: promise => pending.push(promise) },
    ai: { generateText: async () => {
      if (failure) throw new Error("Provider unavailable");
      usage.push({ feature: "smart-label", taskId: task.id });
      return { text: malformed ? "invalid" : JSON.stringify(matches ? [label.id] : []) };
    } },
  };
  const filename = path.join(root, "src/lib/ai/labelClassifier.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", "console", code)(loaded, loaded.exports, id => {
    if (id === "node:crypto") return require(id);
    assert.ok(id in stubs, `Unexpected import: ${id}`);
    return stubs[id];
  }, { error: (...args) => errors.push(args), warn: (...args) => errors.push(args) });
  const batchJobs = load(path.join(root, "src/lib/ai/batch/batchJobs.ts"));
  const loadWithStubs = (relative, extra) => {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = { exports: {} };
    new Function("module", "exports", "require", "console", compiled)(mod, mod.exports, id => {
      const imports = { ...stubs, "@/lib/ai/batch/batchJobs": batchJobs, ...extra };
      assert.ok(id in imports, `Unexpected import: ${id}`);
      return imports[id];
    }, { error: (...args) => errors.push(args), warn: (...args) => errors.push(args) });
    return mod.exports;
  };
  const submit = loadWithStubs("src/lib/ai/labelClassifierBatch.ts", {
    "@/lib/ai/batch/submitBatch": { submitBatch: async args => { submittedBatch = { ...args, id: "batch", gatewayBatchId: "gateway", createdAt: new Date() }; } },
  });
  const collect = loadWithStubs("src/lib/ai/batch/collectBatches.ts", {
    "@/app/api/ai/_lib/aiUsage": { logAiUsage: async () => {} },
    "@/app/api/ai/_lib/sharedAllowance": { modelPricing: async () => null },
    "@/lib/ai/batch/gatewayBatch": { gatewayBatchState: async () => "completed", gatewayBatchOutcomes: async () => [{ id: "t91", status: "succeeded", text: matches ? '["bug"]' : '[]', usage: { inputTokens: 1, outputTokens: 1 } }] },
    "@/lib/ai/labelClassifier": loaded.exports,
    "@/lib/crypto/byokCipher": {}, "@/lib/slack/threadSummary": {}, "@/utils/controllers/comments/createCommentService": {},
  });
  return { ...loaded.exports, ...submit, ...collect, task, label, records, labels, usage, pending, errors,
    fail: value => { failure = value; }, malformed: value => { malformed = value; }, stale: value => { stale = value; } };
}

for (const matches of [true, false]) {
  test(`backfill remembers successful ${matches ? "matching" : "nonmatching"} verdicts`, async () => {
    const f = fixture({ matches });
    await f.backfillAiLabel("bug", 985);
    assert.equal(f.usage.length, 1);
    assert.deepEqual([...f.labels], matches ? ["bug"] : []);
    assert.equal(f.records.size, 1);
    f.usage.length = 0;
    await f.backfillAiLabel("bug", 985);
    assert.deepEqual(f.usage, []);
    assert.deepEqual(f.errors, []);
  });
}

test("changed classifier inputs reclassify, unrelated task changes do not", async () => {
  const f = fixture();
  await f.backfillAiLabel("bug", 985);
  for (const edit of [() => { f.task.title = "Another broken button"; }, () => { f.task.description = "New details"; },
    () => { f.task.description_ = { content: "Updated rich description" }; }, () => { f.label.ai_prompt = "All broken controls"; }]) {
    f.usage.length = 0;
    edit();
    await f.backfillAiLabel("bug", 985);
    assert.equal(f.usage.length, 1);
  }
  f.usage.length = 0;
  f.task.updatedAt = new Date("2026-10-28T15:00:00Z");
  await f.backfillAiLabel("bug", 985);
  assert.equal(f.usage.length, 0);
});

test("a manually changed label remains eligible for repair", async () => {
  const f = fixture();
  await f.backfillAiLabel("bug", 985);
  f.labels.delete("bug");
  await f.backfillAiLabel("bug", 985);
  assert.equal(f.usage.length, 2);
  assert.deepEqual([...f.labels], ["bug"]);
});

for (const kind of ["fail", "malformed", "stale"]) {
  test(`${kind} inference never records a completed verdict`, async () => {
    const f = fixture();
    f[kind](true);
    await f.backfillAiLabel("bug", 985);
    assert.equal(f.records.size, 0);
    f[kind](false);
    f.usage.length = 0;
    await f.backfillAiLabel("bug", 985);
    assert.equal(f.usage.length, 1);
    assert.equal(f.records.size, 1);
  });
}

test("batch dispatch excludes unchanged completed items, not merely submitted items", async () => {
  const f = fixture({ batch: true });
  await f.backfillAiLabel("bug", 985);
  assert.equal(f.pending.length, 1);
  assert.equal(f.records.size, 0);
  await f.backfillAiLabel("bug", 985);
  assert.equal(f.pending.length, 2);
  const submitted = f.pending[0].tasks[0];
  await f.applyAiLabelVerdict({ taskId: 91, projectId: 7283, definitions: [{ labelId: "bug", prompt: f.label.ai_prompt }],
    matchingLabelIds: ["bug"], actor: { id: 100 }, snapshotAt: submitted.updatedAt,
    contentHash: createHash("sha256").update(JSON.stringify([submitted.title, submitted.description])).digest("hex"), classificationSnapshot: submitted.classificationSnapshot });
  assert.equal(f.records.size, 1);
  await f.backfillAiLabel("bug", 985);
  assert.equal(f.pending.length, 2);
  f.task.title = "Changed while batch was waiting";
  await f.backfillAiLabel("bug", 985);
  assert.equal(f.pending.length, 3);
});

test("batch results cannot cache when membership changed after submission", async () => {
  const f = fixture({ batch: true });
  await f.backfillAiLabel("bug", 985);
  const submitted = f.pending[0].tasks[0];
  f.labels.add("bug");
  const result = await f.applyAiLabelVerdict({ taskId: 91, projectId: 7283,
    definitions: [{ labelId: "bug", prompt: f.label.ai_prompt }], matchingLabelIds: [],
    actor: { id: 100 }, snapshotAt: submitted.updatedAt,
    contentHash: createHash("sha256").update(JSON.stringify([submitted.title, submitted.description])).digest("hex"),
    classificationSnapshot: submitted.classificationSnapshot });
  assert.equal(result, undefined);
  assert.equal(f.records.size, 0);
  assert.deepEqual([...f.labels], ["bug"]);
});

test("fingerprint follows the actual truncated classifier prompt", () => {
  const definition = { labelId: "bug", prompt: "Broken" };
  const task = { title: "Title", description: "a".repeat(2000) };
  const hash = output.labelClassificationInputHash(task, definition);
  assert.equal(output.labelClassificationInputHash({ ...task, description: task.description + "ignored" }, definition), hash);
  assert.notEqual(output.labelClassificationInputHash(task, { ...definition, prompt: "Changed" }), hash);
  assert.notEqual(output.labelClassificationInputHash({ ...task, title: "Changed" }, definition), hash);
});

for (const flag of [false, "unavailable"]) {
  test(`backfill repeats inference when flag is ${flag}`, async () => {
    const f = fixture({ flag });
    await f.backfillAiLabel("bug", 985);
    await f.backfillAiLabel("bug", 985);
    assert.equal(f.usage.length, 2);
    assert.equal(f.records.size, 0);
    assert.deepEqual([...f.labels], ["bug"]);
    assert.deepEqual(f.errors, []);
  });
}

for (const changed of [false, true]) {
  test(`real batch submission and collection ${changed ? "preserves manual membership" : "caches verdict"}`, async () => {
    const f = fixture({ batch: true, matches: !changed });
    await f.backfillAiLabel("bug", 985);
    const args = f.pending[0];
    await f.submitSmartLabelBatch(args);
    if (changed) f.labels.add("bug");
    const result = await f.collectBatches();
    assert.equal(result.completed, 1);
    assert.deepEqual([...f.labels], ["bug"]);
    assert.equal(f.records.size, changed ? 0 : 1);
    assert.equal(f.usage.length, 0);
    assert.deepEqual(f.errors, []);
  });
}

test("collector refreshes a batch result after task content changes", async () => {
  const f = fixture({ batch: true });
  await f.backfillAiLabel("bug", 985);
  await f.submitSmartLabelBatch(f.pending[0]);
  f.task.title = "Changed while batch was waiting";
  const result = await f.collectBatches();
  assert.equal(result.completed, 1);
  assert.equal(f.usage.length, 1);
  assert.deepEqual([...f.labels], ["bug"]);
  assert.equal(f.records.size, 0);
  assert.deepEqual(f.errors, []);
});
