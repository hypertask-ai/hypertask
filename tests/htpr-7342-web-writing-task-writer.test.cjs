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
const flag = "htpr-7342-web-writing-task-writer";

async function prepare({ enabled, aiMode = "AiTaskWriter" }) {
  const filename = path.join(root, "src/app/api/ai/_lib/taskWriterRun.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const checks = [];
  const stubs = {
    "@/lib/flags": { ...keys, isFeatureEnabled: async (key, userId) => {
      checks.push([key, userId]);
      return key === flag ? enabled : false;
    } },
    "@/lib/ai/prompts/registry": registry,
    "@/lib/prisma": { __esModule: true, default: {
      project: { findFirst: async () => ({ id: 15, title: "Board", section: [], labels: [] }) },
      section: { findMany: async () => [] },
      taskTemplate: { findMany: async () => [] },
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
  const body = loadedModule.exports.taskWriterRequestSchema.parse({ projectId: 15, PROMPT: "Edit with AI opens the sidebar chat", aiMode });
  return { run: await loadedModule.exports.prepareTaskWriterRun(body, 985), checks };
}

for (const aiMode of ["AiTaskWriter", "WriteWithAI"]) {
  test(`${aiMode} with the flag on writes with web-writing, then unslop, per user`, async () => {
    const { run, checks } = await prepare({ enabled: true, aiMode });
    assert.ok(checks.some(([key, id]) => key === flag && id === 985));
    const webWriting = run.instructions.indexOf("=== SKILL 1: web-writing ===");
    const unslop = run.instructions.indexOf("=== SKILL 2: unslop ===");
    assert.ok(webWriting >= 0 && unslop > webWriting);
    assert.doesNotMatch(run.instructions, /# i-have-adhd/);
    assert.match(run.instructions, /State every fact in exactly one place/);
    assert.match(run.instructions, /Never start a line with "Proposed:"/);
    assert.match(run.instructions, /Questions to people, open questions and status updates belong in comments/);
    assert.match(run.instructions, /Long tickets stay long when the content needs it/);
    assert.match(run.instructions, /Never invent metrics/);
  });

  test(`${aiMode} with the flag off keeps today's prompt byte for byte`, async () => {
    const { run } = await prepare({ enabled: false, aiMode });
    const expected = aiMode === "AiTaskWriter"
      ? taskPrompts.createTaskWriterSystemPromptTemplate(`${editorPrompts.TASK_AUTHORING_STYLE}\n\n${research.TASK_WRITER_BOARD_RESEARCH_RULES}`)
      : editorPrompts.createKanbanSystemPrompt("write_with_ai");
    assert.equal(run.instructions, expected);
    assert.match(run.instructions, /# i-have-adhd/);
  });
}

test("board research with the flag on drops Proposed: labels and the Open questions section", async () => {
  const { run } = await prepare({ enabled: true });
  assert.ok(run.instructions.includes(research.TASK_WRITER_BOARD_RESEARCH_WEB_RULES));
  assert.ok(!run.instructions.includes(research.TASK_WRITER_BOARD_RESEARCH_RULES));
  assert.doesNotMatch(run.instructions, /labeled "Proposed:"|Label guesses with "Proposed:"/);
  assert.doesNotMatch(run.instructions, /End with <h2>Open questions<\/h2>/);
  assert.match(run.instructions, /<h2>Related<\/h2>/);
  assert.match(run.instructions, /Proposed properties/);
  assert.match(run.instructions, /id="ai-generated-task-priority"/);
});

test("web-writing style prompt is shorter than the unslop plus i-have-adhd prompt", () => {
  assert.ok(editorPrompts.TASK_AUTHORING_WEB_STYLE.length < editorPrompts.TASK_AUTHORING_STYLE.length);
  assert.doesNotMatch(editorPrompts.TASK_AUTHORING_WEB_STYLE, /—/);
});
