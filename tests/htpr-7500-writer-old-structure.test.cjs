const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, {
  interopDefault: true, alias: { "@": path.join(root, "src") }, fsCache: false,
});
const keys = load(path.join(root, "src/lib/flags/keys.ts"));
const editorPrompts = load(path.join(root, "src/app/api/ai/_lib/editorAiPrompts.ts"));
const taskPrompts = load(path.join(root, "src/app/api/ai/_lib/taskWriterPrompt.ts"));
const research = load(path.join(root, "src/app/api/ai/_lib/taskWriterBoardResearch.ts"));
const registry = load(path.join(root, "src/lib/ai/prompts/registry.ts"));
const flag = "htpr-7500-writer-old-structure";
const digest = (value) => require("node:crypto").createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function prepare({ enabled, aiMode = "AiTaskWriter", web = true, boardFormat = false }) {
  const filename = path.join(root, "src/app/api/ai/_lib/taskWriterRun.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const checks = [];
  const stubs = {
    "@/lib/flags": { ...keys, isFeatureEnabled: async (key, userId) => {
      checks.push([key, userId]);
      return key === flag ? enabled : key === keys.HTPR_7342_WEB_WRITING_TASK_WRITER_FLAG ? web : key === keys.HTPR_7471_WRITER_BOARD_FORMAT_FLAG ? boardFormat : false;
    } },
    "@/lib/ai/prompts/registry": registry,
    "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async (_userId, { fixed, suffix }) => fixed + suffix },
    "@/lib/prisma": { __esModule: true, default: {
      project: { findFirst: async () => ({ id: 15, title: "Board", section: [], labels: [] }) },
      section: { findMany: async () => [] },
      taskTemplate: { findMany: async () => [] },
      customField: { findMany: async () => [] },
    } },
    "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
    "@/lib/doneColumns": { doneColumnTitles: () => new Set() },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}) },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { searchTasks: async () => [] },
    "@/app/api/ai/_lib/editorAi": { ...editorPrompts,
      selectTaskWriterModel: async () => ({ modelId: "claude-sonnet-5-5" }),
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
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports, console,
    require: (id) => stubs[id] ?? (id.startsWith("@/") ? load(path.join(root, "src", id.slice(2))) : require(id)),
  }, { filename });
  const body = loadedModule.exports.taskWriterRequestSchema.parse({ projectId: 15, PROMPT: "Edit with AI opens the sidebar chat", customInstructions: "BOARD_INSTRUCTION", aiMode });
  return { run: await loadedModule.exports.prepareTaskWriterRun(body, 985), checks };
}

test("production and HTPR-7500 prompt parts preserve their exact original bytes", () => {
  for (const [id, expected] of [
    ["task-authoring-web-style", "c42eeb47023620e8d2365e9e4c00baf42586c4f6858df463b32a38cb743f3699"],
    ["task-writer-board-research-web-rules", "36266a8c3a0be5646da12990a9e1263a0c75c4073b024124f205d5273312405a"],
    ["task-authoring-web-old-structure-style", "ead72cb11838c4e21c95c4dd11be6a7ab936e9db0eee85db79e87836176fe738"],
    ["task-writer-board-research-web-old-structure-rules", "cf72bc1102e777032ef19bdcc62508e58ff417b8e3039bf3d3d9d2f9c6eb4bd1"],
  ]) assert.equal(digest(registry.PROMPTS[id].parts), expected, id);
});

for (const aiMode of ["AiTaskWriter", "WriteWithAI"]) {
  for (const boardFormat of [false, true]) {
    for (const web of [false, true]) {
      test(`${aiMode}, board format=${boardFormat}, web=${web}: flag off preserves production, flag on selects the branch prompts server-side`, async () => {
        const format = aiMode === "AiTaskWriter" && boardFormat;
        const off = await prepare({ enabled: false, aiMode, boardFormat, web });
        const on = await prepare({ enabled: true, aiMode, boardFormat, web });
        const productionStyle = editorPrompts.createTaskAuthoringStyle(web, format);
        const oldStructureStyle = editorPrompts.createTaskAuthoringStyle(web, format, true);
        const expected = (style, rules) => aiMode === "AiTaskWriter"
          ? taskPrompts.createTaskWriterSystemPromptTemplate(`${style}\n\n${rules}`)
          : editorPrompts.createKanbanSystemPrompt("write_with_ai", style);
        const productionRules = web ? research.TASK_WRITER_BOARD_RESEARCH_WEB_RULES : research.TASK_WRITER_BOARD_RESEARCH_RULES;
        const oldStructureRules = web ? registry.renderPrompt("task-writer-board-research-web-old-structure-rules") : research.TASK_WRITER_BOARD_RESEARCH_RULES;
        assert.equal(off.run.instructions, expected(productionStyle, productionRules));
        assert.equal(on.run.instructions, expected(oldStructureStyle, oldStructureRules));
        for (const result of [off, on]) assert.ok(result.checks.some(([key, userId]) => key === flag && userId === 985));
        if (web) {
          assert.notEqual(on.run.instructions, off.run.instructions);
          assert.match(off.run.instructions, /State every fact in exactly one place/);
          assert.doesNotMatch(off.run.instructions, /Restore the board's complete ticket structure/);
          assert.match(on.run.instructions, /Restore the board's complete ticket structure/);
          assert.match(on.run.instructions, /Brevity shortens sections; it never removes them/);
          assert.match(on.run.instructions, /Aim for half the words/);
          assert.match(on.run.instructions, /Impact, Confidence and Ease each a 1-10 score AND one short, specific reason/);
          assert.match(on.run.instructions, /Quote its real copy literally/);
          assert.match(on.run.instructions, /explicitly asks for ideas or finished copy variations/);
          if (aiMode === "AiTaskWriter") {
            assert.match(on.run.instructions, /id="ai-generated-task-priority"/);
            assert.match(on.run.instructions, /An earlier variation is not automatically today's baseline/);
            assert.match(on.run.instructions, /do not invent an experiment/);
            assert.match(on.run.instructions, /Total x\/30/);
          }
        } else assert.equal(on.run.instructions, off.run.instructions);
      });
    }
  }
}

test("the ticket flag is auto-registered as an Everyone improvement with small release risk", () => {
  const definition = load(path.join(root, "src/lib/flags/definitions/htpr-7500-writer-old-structure.ts")).default;
  const { FEATURE_FLAG_DEFINITIONS } = load(path.join(root, "src/lib/flags/definitions.ts"));
  assert.equal(keys.HTPR_7500_WRITER_OLD_STRUCTURE_FLAG, flag);
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-21");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason.length > 0);
  assert.deepEqual(FEATURE_FLAG_DEFINITIONS.filter((entry) => entry.key === flag), [definition]);
});
