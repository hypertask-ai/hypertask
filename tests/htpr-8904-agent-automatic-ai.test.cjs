const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-8904-agent-automatic-ai";

test("agent changes skip automatic AI only while the flag is on for that board owner", () => {
  const { skipAutomaticAiForAgentChange } = loadModule("src/lib/ai/agentAutomaticAi.ts");
  assert.equal(skipAutomaticAiForAgentChange("agent-1", true), true);
  assert.equal(skipAutomaticAiForAgentChange("agent-1", false), false);
  assert.equal(skipAutomaticAiForAgentChange(null, true), false);
  assert.equal(skipAutomaticAiForAgentChange("", true), false);
});

test("the spend flag stays reversible and limited to the owner and QA until release", () => {
  const definition = loadModule("src/lib/flags/definitions/htpr-8904-agent-automatic-ai.ts").default;
  assert.equal(definition.key, flagKey);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.highRisk, "money");
});

function scheduler(relativePath, enabledFor) {
  const jobs = [];
  let checks = [];
  const loaded = loadModule(relativePath, {
    "@/lib/qstash": { scheduleJobById: async (job) => { jobs.push(job); return { messageId: "job" }; } },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => { checks.push({ key, userId }); return enabledFor.includes(userId); } },
    "@/lib/flags/definitions/htpr-7689-prompt-caching": { HTPR_7689_PROMPT_CACHING_FLAG: "htpr-7689-prompt-caching" },
    "@/lib/flags/definitions/htpr-8904-agent-automatic-ai": { HTPR_8904_AGENT_AUTOMATIC_AI_FLAG: flagKey },
  });
  return { schedule: loaded.default, jobs, readChecks: () => checks };
}

test("agent ticket and comment summaries are not scheduled, and a person's change still is", async () => {
  const tasks = scheduler("src/pages/api/queues/FAST/generateSummary.ts", [6]);
  await tasks.schedule({ taskId: 10, agentId: "agent-1", ownerUserId: 6 });
  await tasks.schedule({ taskId: 11, agentId: "agent-1", ownerUserId: 42 });
  await tasks.schedule({ taskId: 12, ownerUserId: 6 });
  assert.deepEqual(tasks.jobs.map((job) => job.body), [
    { taskId: 11, agentId: "agent-1" },
    { taskId: 12 },
  ]);
  assert.deepEqual(tasks.readChecks(), [
    { key: flagKey, userId: 6 },
    { key: flagKey, userId: 42 },
  ]);

  const comments = scheduler("src/pages/api/queues/FAST/generateCommentSummary.ts", [6]);
  await comments.schedule({ commentId: 8, agentId: "agent-1", ownerUserId: 6 });
  await comments.schedule({ commentId: 9, agentId: null, ownerUserId: 6 });
  assert.deepEqual(comments.jobs.map((job) => job.body), [{ commentId: 9 }]);
});

test("agent-created tickets and agent edits skip smart labels; a person's edit still classifies", async () => {
  const calls = [];
  const tasks = new Map([
    [1, { id: 1, projectId: 3, userId: 6, agentId: "agent-1", title: "Agent", description: "", updatedAt: new Date(), description_: null, project: { teamId: "team" } }],
    [2, { id: 2, projectId: 3, userId: 6, agentId: null, title: "Person", description: "", updatedAt: new Date(), description_: null, project: { teamId: "team" } }],
  ]);
  const loaded = loadModule("src/lib/ai/labelClassifier.ts", {
    "@/lib/prisma": { default: {
      task: { findFirst: async ({ where }) => tasks.get(where.id) ?? null, findMany: async () => [...tasks.values()] },
      taskLabel: { findMany: async () => [] },
      label: { findMany: async () => [{ id: "bug", ai_prompt: "Broken" }], findUnique: async () => ({ id: "bug", projectId: 3, ai_prompt: "Broken" }) },
      user: { findUnique: async () => ({ id: 100, displayName: "HyperAI" }) },
    } },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => key === flagKey && userId === 6 },
    "@/lib/flags/definitions/htpr-8904-agent-automatic-ai": { HTPR_8904_AGENT_AUTOMATIC_AI_FLAG: flagKey },
    "@/lib/flags/definitions/htpr-7850-label-backfill-skip-unchanged": { HTPR_7850_LABEL_BACKFILL_SKIP_UNCHANGED_FLAG: "htpr-7850-label-backfill-skip-unchanged" },
    "@/lib/flags/definitions/htpr-8099-smart-label-refusal": { HTPR_8099_SMART_LABEL_REFUSAL_FLAG: "htpr-8099-smart-label-refusal" },
    "@/lib/flags/definitions/yper4-915-error-log-never-bug": { YPER4_915_ERROR_LOG_NEVER_BUG_FLAG: "yper4-915-error-log-never-bug" },
    "@/lib/net/downloadWithoutBrotli": {},
    "@/app/api/ai/_lib/planAllowancePolicy": { teamPlanAllowanceEnabled: async () => false },
    "@/app/api/ai/_lib/byokKeys": { getTeamGatewayApiKey: async () => "vck_fixture", resolveAutomaticAiModel: () => ({}) },
    "@/app/api/ai/_lib/planGate": { batchBackgroundAiEnabled: async () => false },
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {}, gatewayProviderOptionsForModel: () => ({}), gatewayFundingSourceForApiKey: () => "gateway" },
    "@/app/api/ai/_lib/sharedAllowance": { gatewayCatalogModelSlug: (value) => value },
    "@/app/api/ai/_lib/allowanceError": { findSharedAiAllowanceError: () => undefined },
    "@/app/api/ai/_lib/taskContent": { convertHtmlToText: (value) => value || "" },
    "@/lib/ai/batch/batchJobs": { batchEligibleFunding: () => false, batchEligibleModel: () => false, labelTaskContentHash: () => "hash" },
    "@/lib/ai/labelClassifierBatch": { submitSmartLabelBatch: async () => {} },
    "@/lib/configs/general.config": { generalConfig: { hyperAiId: 100 } },
    "@/lib/ai/labelClassifierOutput": loadModule("src/lib/ai/labelClassifierOutput.ts"),
    "@/lib/realtime/server": { broadcastBoardChange: async () => {} },
    "@/lib/agentWebhooks/outbox": { persistAgentTaskUpdatedWebhook: async () => [], publishAgentWebhookDeliveries: async () => {} },
    "@/utils/controllers/activities/createLabelActivity": { default: async () => {} },
    "@vercel/functions": { waitUntil: () => {} },
    ai: { generateText: async () => { calls.push("model"); return { text: "[]" }; } },
  });
  await loaded.classifyNewTaskAiLabels(1, 3);
  await loaded.classifyTaskAiLabels(1, 3, new Set(), { agentId: "agent-1" });
  await assert.rejects(
    loaded.classifyTaskAiLabels(2, 3, new Set(), { agentId: null }),
    /\$transaction is not a function/,
  );
  assert.deepEqual(calls, ["model"]);
});
