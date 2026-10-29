const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const classifierOutput = load(path.join(root, "src/lib/ai/labelClassifierOutput.ts"));

const BUG_LABEL = "b5a1d852-fafc-4c22-b63e-36b20ac640f4";
const TASK_ID = 64540;
const PROJECT_ID = 6859;

function boardWith({ taskLabelIds, modelMatches }) {
  const taskLabels = new Set(taskLabelIds);
  const removed = [];
  const added = [];
  const updatedAt = new Date("2026-10-19T06:00:00Z");
  const task = {
    id: TASK_ID,
    title: "Weekly planning notes",
    description: "",
    userId: 2343,
    agentId: null,
    projectId: PROJECT_ID,
    updatedAt,
    description_: { content: "" },
    project: { teamId: "team-qa" },
  };
  const taskLabelRows = (labelIds) =>
    [...taskLabels]
      .filter((labelId) => !labelIds || labelIds.includes(labelId))
      .map((labelId) => ({ taskId: TASK_ID, labelId, label: { id: labelId, value: "QA7098 control" } }));
  const taskLabel = {
    findMany: async ({ where }) => taskLabelRows(where.labelId?.in),
    upsert: async ({ create }) => {
      taskLabels.add(create.labelId);
      added.push(create.labelId);
      return { ...create, label: { id: create.labelId, value: "QA7098 control" } };
    },
    deleteMany: async ({ where }) => {
      taskLabels.delete(where.labelId);
      removed.push(where.labelId);
    },
  };
  const tx = {
    $queryRaw: async () => [{ id: TASK_ID }],
    task: { findUnique: async () => task },
    taskLabel,
  };
  const prisma = {
    label: {
      findMany: async () => [{ id: BUG_LABEL, ai_prompt: "Tasks that describe a broken feature or bug" }],
    },
    task: { findFirst: async () => task },
    user: { findUnique: async () => ({ id: 100, displayName: "HyperAI" }) },
    taskLabel,
    $transaction: async (work) => work(tx),
  };
  const classifiedDefinitions = [];
  const stubs = {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/app/api/ai/_lib/byokKeys": {
      getTeamGatewayApiKey: async () => "vck_fixture",
      resolveAutomaticAiModel: () => ({ modelId: "fixture" }),
    },
    "@/app/api/ai/_lib/planGate": {
      haikuDefaultModelEnabled: async () => false,
      batchBackgroundAiEnabled: async () => false,
    },
    "@/app/api/ai/_lib/modelProvider": {
      configureAiModelUsage: () => undefined,
      resolveGatewayModel: () => ({ modelId: "fixture" }),
      gatewayProviderOptionsForModel: () => undefined,
      gatewayFundingSourceForApiKey: () => "gateway",
    },
    "@/app/api/ai/_lib/taskContent": { convertHtmlToText: (value) => value },
    "@/lib/configs/general.config": { generalConfig: { hyperAiId: 100 } },
    "@/lib/ai/labelClassifierOutput": classifierOutput,
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/lib/realtime/server": { broadcastBoardChange: async () => undefined },
    "@/lib/agentWebhooks/outbox": {
      persistAgentTaskUpdatedWebhook: async () => [],
      publishAgentWebhookDeliveries: async () => undefined,
    },
    "@/utils/controllers/activities/createLabelActivity": { __esModule: true, default: async () => undefined },
    "@vercel/functions": { waitUntil: () => undefined },
    ai: {
      generateText: async ({ prompt }) => {
        classifiedDefinitions.push(prompt);
        return { text: JSON.stringify(modelMatches) };
      },
    },
  };
  const filename = path.join(root, "src/lib/ai/labelClassifier.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded,
    exports: loaded.exports,
    require: (id) => stubs[id] ?? (id.startsWith("@/") ? {} : require(id)),
    process: { env: {} },
    console: { ...console, error: () => undefined, warn: () => undefined },
    performance,
    setTimeout,
    clearTimeout,
  }, { filename });
  return { classifier: loaded.exports, taskLabels, removed, added, classifiedDefinitions };
}

test("a new task keeps the AI label its creator picked when the AI would not pick it", async () => {
  const board = boardWith({ taskLabelIds: [BUG_LABEL], modelMatches: [] });
  await board.classifier.classifyNewTaskAiLabels(TASK_ID, PROJECT_ID);
  assert.deepEqual(board.removed, []);
  assert.ok(board.taskLabels.has(BUG_LABEL));
});

test("a new task with no picked labels still gets a matching AI label", async () => {
  const board = boardWith({ taskLabelIds: [], modelMatches: [BUG_LABEL] });
  await board.classifier.classifyNewTaskAiLabels(TASK_ID, PROJECT_ID);
  assert.deepEqual(board.added, [BUG_LABEL]);
  assert.ok(board.taskLabels.has(BUG_LABEL));
});

test("editing a task still lets the AI remove an AI label that no longer fits", async () => {
  const board = boardWith({ taskLabelIds: [BUG_LABEL], modelMatches: [] });
  await board.classifier.classifyTaskAiLabels(TASK_ID, PROJECT_ID);
  assert.deepEqual(board.removed, [BUG_LABEL]);
  assert.equal(board.taskLabels.has(BUG_LABEL), false);
});
