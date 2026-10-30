const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModule } = require("./helpers/loadModule.cjs");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, {
  interopDefault: true, alias: { "@": path.join(root, "src") }, fsCache: false,
});
const keys = load(path.join(root, "src/lib/flags/keys.ts"));
const editor = load(path.join(root, "src/app/api/ai/_lib/editorAiPrompts.ts"));
const taskPrompts = load(path.join(root, "src/app/api/ai/_lib/taskWriterPrompt.ts"));
const research = load(path.join(root, "src/app/api/ai/_lib/taskWriterBoardResearch.ts"));
const registry = load(path.join(root, "src/lib/ai/prompts/registry.ts"));
const flag = "htpr-7977-short-task-writer";
const shortRule = registry.renderPrompt("task-writer-short-style-rule");

async function prepare({ enabled, web, oldStructure, aiMode = "AiTaskWriter", boardRules = "BOARD_RULES_SENTINEL", templates = [], note = "Fix the login button" }) {
  const checks = [];
  const stubs = {
    "@/lib/flags": { ...keys, isFeatureEnabled: async (key, userId) => {
      checks.push([key, userId]);
      return key === flag ? enabled : key === keys.HTPR_7342_WEB_WRITING_TASK_WRITER_FLAG ? web : key === keys.HTPR_7500_WRITER_OLD_STRUCTURE_FLAG ? oldStructure : key === keys.HTPR_7471_WRITER_BOARD_FORMAT_FLAG;
    } },
    "@/lib/ai/prompts/registry": registry,
    "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async (_userId, { fixed, suffix }) => fixed + suffix },
    "@/lib/prisma": { __esModule: true, default: {
      project: { findFirst: async () => ({ id: 15 }) },
      section: { findMany: async () => [] },
      taskTemplate: { findMany: async () => templates },
      customField: { findMany: async () => [] },
    } },
    "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
    "@/lib/doneColumns": { doneColumnTitles: () => new Set() },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}) },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { searchTasks: async () => [] },
    "@/app/api/ai/_lib/editorAi": { ...editor,
      selectTaskWriterModel: async () => ({ modelId: "writer-fixture" }),
      retrieveTaskWriterContext: async () => "",
      createDocumentAttachmentSummary: () => "",
      createTaskWriterUserContent: (input) => input,
      extractImgSrcs: () => new Set(),
    },
    "@/app/api/ai/_lib/taskWriterPrompt": taskPrompts,
    "@/app/api/ai/_lib/taskWriterBoardResearch": research,
    "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async () => ({ settings: {} }) },
    "@/app/api/ai/_lib/skills": { resolveSkills: async (text) => ({ cleanedText: text, skills: [], systemPromptAddition: "" }) },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "", resolveAiUsageTaskId: async () => null },
  };
  const { taskWriterRequestSchema, prepareTaskWriterRun } = loadModule("src/app/api/ai/_lib/taskWriterRun.ts", stubs);
  const body = taskWriterRequestSchema.parse({ projectId: 15, PROMPT: note, customInstructions: boardRules, aiMode });
  return { run: await prepareTaskWriterRun(body, 985), checks };
}

for (const web of [false, true]) {
  for (const oldStructure of [false, true]) {
    test(`shared dispatch preserves flag-off prompts and board inputs: web=${web}, old=${oldStructure}`, async () => {
      const options = { web, oldStructure };
      const off = await prepare({ ...options, enabled: false });
      const on = await prepare({ ...options, enabled: true });
      const style = editor.createTaskAuthoringStyle(web, true, oldStructure);
      const rules = web ? oldStructure ? registry.renderPrompt("task-writer-board-research-web-old-structure-rules") : research.TASK_WRITER_BOARD_RESEARCH_WEB_RULES : research.TASK_WRITER_BOARD_RESEARCH_RULES;
      assert.equal(off.run.instructions, taskPrompts.createTaskWriterSystemPromptTemplate(`${style}\n\n${rules}`));
      assert.equal(on.run.instructions, `${off.run.instructions}\n\n${shortRule}`);
      assert.equal(on.run.messages[0].content, off.run.messages[0].content);
      assert.match(on.run.messages[0].content, /BOARD_RULES_SENTINEL/);
      assert.match(on.run.messages[0].content, /Fix the login button/);
      assert.ok(on.checks.some(([key, id]) => key === flag && id === 985));
    });
  }
}

test("A/B board instructions and templates survive unchanged alongside the explicit two-condition rule", async () => {
  const options = {
    web: true, oldStructure: true,
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

test("WriteWithAI keeps its exact instructions and does not evaluate the new flag", async () => {
  const options = { web: true, oldStructure: true, aiMode: "WriteWithAI" };
  const off = await prepare({ ...options, enabled: false });
  const on = await prepare({ ...options, enabled: true });
  assert.equal(on.run.instructions, off.run.instructions);
  assert.equal(on.run.messages[0].content, off.run.messages[0].content);
  assert.equal(on.checks.some(([key]) => key === flag), false);
  assert.doesNotMatch(on.run.instructions, /TASK-SPECIFIC STRUCTURE AND LENGTH/);
});

test("ticket flag is registered with the standard low-risk improvement default", () => {
  const definition = load(path.join(root, "src/lib/flags/definitions/htpr-7977-short-task-writer.ts")).default;
  const { FEATURE_FLAG_DEFINITIONS } = load(path.join(root, "src/lib/flags/definitions.ts"));
  assert.equal(keys.HTPR_7977_SHORT_TASK_WRITER_FLAG, flag);
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.deepEqual(FEATURE_FLAG_DEFINITIONS.filter((entry) => entry.key === flag), [definition]);
});
