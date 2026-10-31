const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const output = load(path.join(root, "src/lib/ai/labelClassifierOutput.ts"));
const allowanceError = load(path.join(root, "src/app/api/ai/_lib/allowanceError.ts"));
const flag = "htpr-8099-smart-label-refusal";

function fixture({ error, failAt = "generate", enabled = true, flagError = false } = {}) {
  const errors = [], pending = [], activities = [], broadcasts = [];
  const labels = new Set(["existing"]);
  const updatedAt = new Date("2026-10-27T14:00:00Z");
  const task = { id: 91, projectId: 7283, title: "Broken button", description: "Cannot click", userId: 985,
    agentId: null, updatedAt, description_: null, project: { teamId: "qa-team" } };
  const definitions = [{ id: "existing", ai_prompt: "Old work" }, { id: "bug", ai_prompt: "Broken features" }];
  const rows = () => [...labels].map((labelId) => ({ taskId: 91, labelId, label: { id: labelId, value: labelId } }));
  const taskLabel = {
    findMany: async ({ where }) => rows().filter((row) => !where.labelId?.in || where.labelId.in.includes(row.labelId)),
    upsert: async ({ create }) => { labels.add(create.labelId); return { ...create, label: { id: create.labelId, value: create.labelId } }; },
    deleteMany: async ({ where }) => { labels.delete(where.labelId); },
  };
  const prisma = {
    label: { findMany: async ({ where }) => definitions.filter((label) => !where.id?.in || where.id.in.includes(label.id)), findUnique: async () => ({ ...definitions[1], projectId: 7283 }) },
    task: { findFirst: async () => task, findMany: async () => [task] },
    user: { findUnique: async () => ({ id: 100, displayName: "HyperAI" }) },
    taskLabel,
    $transaction: async (work) => work({ $queryRaw: async () => [{ id: 91 }], taskLabel }),
  };
  const stubs = {
    "@/lib/ai/teamAiFunding": require("./helpers/team-ai-funding-stub.cjs"),
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/net/downloadWithoutBrotli": {},
    "@/app/api/ai/_lib/planAllowancePolicy": {},
    "@/app/api/ai/_lib/byokKeys": {
      resolveAutomaticAiModel: () => ({}),
      getTeamGatewayApiKey: async () => { if (error && failAt === "funding") throw error; return "vck_fixture"; },
    },
    "@/app/api/ai/_lib/planGate": { batchBackgroundAiEnabled: async () => false },
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {}, gatewayProviderOptionsForModel: () => ({}) },
    "@/app/api/ai/_lib/sharedAllowance": {},
    "@/app/api/ai/_lib/allowanceError": allowanceError,
    "@/app/api/ai/_lib/taskContent": { convertHtmlToText: (value) => value },
    "@/lib/ai/batch/batchJobs": {},
    "@/lib/ai/labelClassifierBatch": {},
    "@/lib/configs/general.config": { generalConfig: { hyperAiId: 100 } },
    "@/lib/ai/labelClassifierOutput": output,
    "@/lib/realtime/server": { broadcastBoardChange: async (projectId) => broadcasts.push(projectId) },
    "@/lib/agentWebhooks/outbox": { persistAgentTaskUpdatedWebhook: async () => [], publishAgentWebhookDeliveries: async () => {} },
    "@/utils/controllers/activities/createLabelActivity": { __esModule: true, default: async ({ status }) => activities.push(status) },
    "@/lib/flags": { isFeatureEnabled: async (key) => { if (key === "yper4-915-error-log-never-bug") return true; assert.equal(key, flag); if (flagError) throw new Error("Flag store unavailable"); return enabled; } },
    "@/lib/flags/definitions/htpr-8099-smart-label-refusal": { HTPR_8099_SMART_LABEL_REFUSAL_FLAG: flag },
    "@/lib/flags/definitions/yper4-915-error-log-never-bug": { YPER4_915_ERROR_LOG_NEVER_BUG_FLAG: "yper4-915-error-log-never-bug" },
    "@vercel/functions": { waitUntil: (promise) => pending.push(promise) },
    ai: { generateText: async () => { if (error) throw error; return { text: '["bug"]' }; } },
  };
  const filename = path.join(root, "src/lib/ai/labelClassifier.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", "console", code)(loaded, loaded.exports, (id) => {
    assert.ok(id in stubs, `Unexpected import: ${id}`);
    return stubs[id];
  }, { error: (...args) => errors.push(args), warn: (...args) => errors.push(args) });
  async function run(entry) {
    if (entry === "new") loaded.exports.scheduleClassifyNewTaskAiLabels(91, 7283);
    else if (entry === "update") loaded.exports.scheduleClassifyTaskAiLabels(91, 7283);
    else loaded.exports.scheduleBackfillAiLabel("bug", 985);
    assert.equal(pending.length, 1);
    await Promise.all(pending);
    return { labels: [...labels], activities, broadcasts, errors };
  }
  return { run };
}

for (const entry of ["new", "update", "backfill"]) {
  test(`${entry} dispatch quietly preserves labels on direct and wrapped allowance refusals`, async () => {
    for (const reason of ["month", "day"]) {
      const refusal = Object.assign(new Error("Included AI allowance used"), { name: "SharedAiAllowanceExceededError", reason });
      for (const error of [refusal, new Error("Retry exhausted", { cause: refusal }), Object.assign(new Error("Retry exhausted"), { lastError: refusal })]) {
        for (const failAt of ["funding", "generate"]) {
          assert.deepEqual(await fixture({ error, failAt }).run(entry), { labels: ["existing"], activities: [], broadcasts: [], errors: [] });
        }
      }
    }
  });
  test(`${entry} dispatch preserves successful classification and reports genuine failures`, async () => {
    for (const enabled of [false, true]) {
      const result = await fixture({ enabled }).run(entry);
      assert.deepEqual(result.labels, entry === "update" ? ["bug"] : ["existing", "bug"]);
      assert.deepEqual(result.activities, entry === "update" ? ["Assigned", "Removed"] : ["Assigned"]);
      assert.deepEqual(result.broadcasts, [7283]);
      assert.deepEqual(result.errors, []);
      const error = new Error("Provider unavailable");
      const failed = await fixture({ error, enabled }).run(entry);
      assert.deepEqual(failed.labels, ["existing"]);
      assert.equal(failed.errors.length, 1);
      assert.equal(failed.errors[0].at(-1), error);
    }
  });
  test(`${entry} dispatch retains reporting when rollback or flag lookup fails`, async () => {
    const error = Object.assign(new Error("Included AI allowance used"), { name: "SharedAiAllowanceExceededError" });
    for (const options of [{ enabled: false }, { flagError: true }]) {
      for (const failAt of ["funding", "generate"]) {
        const result = await fixture({ error, failAt, ...options }).run(entry);
        assert.deepEqual(result.labels, ["existing"]);
        assert.equal(result.errors.length, 1);
        assert.equal(result.errors[0].at(-1), error);
      }
    }
  });
}
