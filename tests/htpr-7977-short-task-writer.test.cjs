const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, {
  interopDefault: true, alias: { "@": path.join(root, "src") }, fsCache: false,
});
const keys = load(path.join(root, "src/lib/flags/keys.ts"));
const editorPrompts = load(path.join(root, "src/app/api/ai/_lib/editorAiPrompts.ts"));
const taskPrompts = load(path.join(root, "src/app/api/ai/_lib/taskWriterPrompt.ts"));
const research = load(path.join(root, "src/app/api/ai/_lib/taskWriterBoardResearch.ts"));
const registry = load(path.join(root, "src/lib/ai/prompts/registry.ts"));
const flag = "htpr-7977-short-task-writer";
const shortRule = registry.renderPrompt("task-writer-short-style-rule");

async function prepare({ enabled, aiMode = "AiTaskWriter", boardRules = "BOARD_RULES_SENTINEL", templates = [], note = "Fix the login button" }) {
  const checks = [];
  const stubs = {
    "@/lib/flags": { ...keys, isFeatureEnabled: async (key, userId) => {
      checks.push([key, userId]);
      return key === flag && enabled;
    } },
    "@/lib/ai/prompts/registry": registry,
    "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async (_userId, { fixed, suffix }) => fixed + suffix },
    "@/lib/prisma": { __esModule: true, default: {
      project: { findFirst: async () => ({ id: 15, title: "Board", section: [], labels: [] }) },
      section: { findMany: async () => [] },
      taskTemplate: { findMany: async () => templates },
      customField: { findMany: async () => [] },
      label: { findMany: async () => [] },
    } },
    "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
    "@/lib/doneColumns": { doneColumnTitles: () => new Set() },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}), taskWriteAccessWhere: () => ({}) },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { searchTasks: async () => [] },
    "@/lib/rag/authorizeIndexedRows": { authorizeIndexedRows: async () => ({ taskRows: [] }) },
    "@/app/api/ai/_lib/editorAi": { ...editorPrompts,
      selectTaskWriterModel: async () => ({ modelId: "writer-fixture" }),
      retrieveTaskWriterContext: async () => "",
      createDocumentAttachmentSummary: () => "",
      createTaskWriterUserContent: (input) => input,
      extractImgSrcs: () => new Set(),
    },
    "@/app/api/ai/_lib/taskWriterPrompt": taskPrompts,
    "@/app/api/ai/_lib/taskWriterBoardResearch": research,
    "@/app/api/ai/_lib/boardTemplateContext": load(path.join(root, "src/app/api/ai/_lib/boardTemplateContext.ts")),
    "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async () => ({ settings: {} }) },
    "@/app/api/ai/_lib/skills": { resolveSkills: async (text) => ({ cleanedText: text, skills: [], systemPromptAddition: "" }) },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "", resolveAiUsageTaskId: async () => null },
  };
  const { taskWriterRequestSchema, prepareTaskWriterRun } = loadModule("src/app/api/ai/_lib/taskWriterRun.ts", stubs);
  const body = taskWriterRequestSchema.parse({ projectId: 15, PROMPT: note, customInstructions: boardRules, aiMode });
  return { run: await prepareTaskWriterRun(body, 985), checks };
}

test("flag off keeps the production writer prompt and flag on appends only the short rule", async () => {
  const off = await prepare({ enabled: false });
  const on = await prepare({ enabled: true });
  assert.equal(off.run.instructions, taskPrompts.createTaskWriterSystemPromptTemplate(`${editorPrompts.TASK_AUTHORING_WEB_STYLE}\n\n${research.TASK_WRITER_BOARD_RESEARCH_WEB_RULES}`));
  assert.equal(on.run.instructions, `${off.run.instructions}\n\n${shortRule}`);
  assert.equal(on.run.messages[0].content, off.run.messages[0].content);
  assert.match(on.run.messages[0].content, /BOARD_RULES_SENTINEL/);
  assert.match(on.run.messages[0].content, /Fix the login button/);
  assert.equal(off.checks.some(([key]) => key === flag), true);
  assert.ok(on.checks.some(([key, id]) => key === flag && id === 985));
  assert.doesNotMatch(off.run.instructions, /TASK-SPECIFIC STRUCTURE AND LENGTH/);
});

test("A/B board instructions and templates stay in the user message beside the two-condition rule", async () => {
  const options = {
    boardRules: "A/B tests use Problem, Hypothesis, Control, Variations, Requirements, ICE assessment, Suggested metrics and Related.",
    templates: [{ name: "A/B test", title: "[Web] Test CTA ICE 21/30", descriptionHtml: "<h2>Hypothesis</h2><h2>Control</h2><h2>Variations</h2><h2>ICE assessment</h2>" }],
    note: "A/B test: compare the current CTA with a proposed shorter one. Preserve the current page copy.",
  };
  const off = await prepare({ ...options, enabled: false });
  const on = await prepare({ ...options, enabled: true });
  assert.equal(on.run.messages[0].content, off.run.messages[0].content);
  assert.match(on.run.messages[0].content, /BOARD_TEMPLATES/);
  assert.match(on.run.messages[0].content, /A\/B test/);
  assert.match(on.run.messages[0].content, /ICE assessment/);
  assert.match(on.run.instructions, /only when BOTH conditions hold/);
  assert.match(on.run.instructions, /board instructions or a matching template explicitly request that layout/);
  assert.match(on.run.instructions, /under 240 visible words/);
  assert.match(on.run.instructions, /source-grounded Control, numbered variations/);
  assert.match(on.run.instructions, /A bug or feature on an experiment board is still not an A\/B test/);
});

test("WriteWithAI keeps its exact instructions and does not read the short-writer flag", async () => {
  const off = await prepare({ enabled: false, aiMode: "WriteWithAI" });
  const on = await prepare({ enabled: true, aiMode: "WriteWithAI" });
  assert.equal(on.run.instructions, off.run.instructions);
  assert.equal(on.run.messages[0].content, off.run.messages[0].content);
  assert.equal(on.checks.some(([key]) => key === flag), false);
  assert.doesNotMatch(on.run.instructions, /TASK-SPECIFIC STRUCTURE AND LENGTH/);
});

test("ticket flag is a small bugfix that stays Owner + QA", () => {
  const definition = load(path.join(root, "src/lib/flags/definitions/htpr-7977-short-task-writer.ts")).default;
  const { FEATURE_FLAG_DEFINITIONS } = load(path.join(root, "src/lib/flags/definitions.ts"));
  assert.equal(keys.HTPR_7977_SHORT_TASK_WRITER_FLAG, flag);
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.equal(definition.releaseRisk.highRisk, undefined);
  assert.deepEqual(FEATURE_FLAG_DEFINITIONS.filter((entry) => entry.key === flag), [definition]);
});
