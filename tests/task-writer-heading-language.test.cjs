const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, {
  interopDefault: true, alias: { "@": path.join(root, "src") }, fsCache: false,
});
const keys = load(path.join(root, "src/lib/flags/keys.ts"));
const editorPrompts = load(path.join(root, "src/app/api/ai/_lib/editorAiPrompts.ts"));
const taskPrompts = load(path.join(root, "src/app/api/ai/_lib/taskWriterPrompt.ts"));
const research = load(path.join(root, "src/app/api/ai/_lib/taskWriterBoardResearch.ts"));
const registry = load(path.join(root, "src/lib/ai/prompts/registry.ts"));
const flag = "htpr-7057-writer-heading-language";

async function prepare({ prompt, enabled = true, boardResearch = true, aiMode = "AiTaskWriter" }) {
  const filename = path.join(root, "src/app/api/ai/_lib/taskWriterRun.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const checks = [];
  const stubs = {
    "@/lib/flags": { ...keys, isFeatureEnabled: async (key, userId) => {
      checks.push([key, userId]);
      return key === flag ? enabled : key === research.HTPR_6363_TASK_WRITER_RESEARCH_FLAG && boardResearch;
    } },
    "@/lib/ai/prompts/registry": registry,
    "@/lib/prisma": { __esModule: true, default: {
      project: { findFirst: async () => ({ id: 7057, title: "English board", section: [], labels: [] }) },
      section: { findMany: async () => [] },
      taskTemplate: { findMany: async () => [{ name: "Bug", title: "Bug", descriptionHtml: "<h2>Problem</h2><h2>Acceptance criteria</h2><h2>Out of scope</h2>" }] },
    } },
    "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
    "@/lib/doneColumns": { doneColumnTitles: () => new Set() },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}) },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { searchTasks: async () => [] },
    "@/app/api/ai/_lib/editorAi": { ...editorPrompts,
      selectTaskWriterModel: async () => ({ modelId: "claude-sonnet-5-5" }),
      retrieveTaskWriterContext: async () => "English board context",
      createDocumentAttachmentSummary: () => "",
      createTaskWriterUserContent: (input) => input,
      extractImgSrcs: () => new Set(),
    },
    "@/app/api/ai/_lib/taskWriterPrompt": taskPrompts,
    "@/app/api/ai/_lib/taskWriterBoardResearch": research,
    "@/app/api/ai/_lib/boardTemplateContext": load(path.join(root, "src/app/api/ai/_lib/boardTemplateContext.ts")),
    "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async () => ({ settings: {} }) },
    "@/app/api/ai/_lib/skills": { resolveSkills: async (text) => ({ cleanedText: text, skills: [], systemPromptAddition: "Use the board structure." }) },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "", resolveAiUsageTaskId: async () => null },
  };
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports, console,
    require: (id) => stubs[id] ?? (id.startsWith("@/") ? load(path.join(root, "src", id.slice(2))) : require(id)),
  }, { filename });
  const body = loadedModule.exports.taskWriterRequestSchema.parse({ projectId: 7057, PROMPT: prompt, aiMode });
  return { run: await loadedModule.exports.prepareTaskWriterRun(body, 1000), checks };
}

for (const boardResearch of [true, false]) {
  for (const prompt of [
    "Behebe den Fehler beim Speichern. Bitte auf Deutsch schreiben",
    "Behebe den Fehler beim Speichern. Nach dem Speichern bleibt der Inhalt erhalten.",
    "Fix saving the description. After saving, the content remains visible.",
    "Behebe den Fehler beim Speichern. Bitte auf Französisch schreiben.",
    "保存時に内容が消える不具合を修正してください。",
  ]) {
    test(`language contract applies to request with research ${boardResearch}: ${prompt}`, async () => {
      const { run, checks } = await prepare({ prompt, boardResearch });
      assert.ok(checks.some(([key, id]) => key === flag && id === 1000));
      assert.ok(run.messages[0].content.endsWith(prompt));
      assert.match(run.instructions, /language the user explicitly asks for/);
      assert.match(run.instructions, /otherwise use the language of the user's request/);
      assert.match(run.instructions, /not the language of board context, templates, or examples/);
      assert.match(run.instructions, /Translate all section headings/);
      assert.match(run.instructions, /<h2>Akzeptanzkriterien<\/h2>/);
      assert.match(run.instructions, /For English output, keep the English headings/);
      assert.match(run.instructions, /overrides.*headings.*verbatim/);
      assert.match(run.instructions, /same section meanings, order, and HTML structure/);
      assert.match(run.instructions, /Keep all existing structured IDs, numeric property values, URLs, and media tokens unchanged/);
      assert.match(run.instructions, /<p id="ai-generated-task-properties">/);
    });
  }
  test(`flag off preserves today's full prompt with research ${boardResearch}`, async () => {
    const prompt = "Behebe den Fehler beim Speichern. Bitte auf Deutsch schreiben";
    const { run } = await prepare({ prompt, enabled: false, boardResearch });
    const expected = boardResearch
      ? taskPrompts.createTaskWriterSystemPromptTemplate(`${editorPrompts.TASK_AUTHORING_STYLE}\n\n${research.TASK_WRITER_BOARD_RESEARCH_RULES}`)
      : editorPrompts.createKanbanSystemPrompt("task_writer");
    assert.equal(run.instructions, `${expected}\n\nUse the board structure.`);
  });
}

test("Write with AI has its own comment template and stays unchanged", async () => {
  const prompt = "Bitte auf Deutsch schreiben";
  const on = await prepare({ prompt, aiMode: "WriteWithAI" });
  const off = await prepare({ prompt, aiMode: "WriteWithAI", enabled: false });
  assert.equal(on.run.instructions, off.run.instructions);
  assert.equal(on.run.instructions, `${editorPrompts.createKanbanSystemPrompt("write_with_ai")}\n\nUse the board structure.`);
  assert.ok(!on.checks.some(([key]) => key === flag));
  assert.doesNotMatch(on.run.instructions, /sections covering: problem, affected screen, acceptance criteria, out of scope/);
});

test("German headings and localized property chrome survive extraction correctly on server and browser", () => {
  const { extractTaskWriterProperties } = load(path.join(root, "src/app/api/ai/_lib/taskWriterProperties.ts"));
  const { extractTitleAndDescription, extractTaskProperties } = load(path.join(root, "src/utils/aiWriterUtils.ts"));
  const description = "<h2>Problem</h2><p>Der Inhalt geht verloren.</p><h2>Akzeptanzkriterien</h2><p>Der Inhalt bleibt erhalten.</p><h2>Nicht im Umfang</h2><p>Keine Layoutänderung.</p>";
  const html = '<h1 id="ai-generated-task-title">Speichern reparieren</h1>' + description +
    '<p id="ai-generated-task-properties">Vorgeschlagene Eigenschaften: Priorität <strong>Hoch</strong>, Größe <strong>S</strong>' +
    '<span id="ai-generated-task-priority" style="display:none">2</span><span id="ai-generated-task-estimate" style="display:none">3</span></p>';
  const server = extractTaskWriterProperties(html);
  assert.equal(server.title, "Speichern reparieren");
  assert.equal(server.description, description);
  assert.equal(server.priority, 2);
  assert.equal(server.estimate, 3);
  const previous = global.DOMParser;
  global.DOMParser = new JSDOM("").window.DOMParser;
  try {
    assert.equal(extractTitleAndDescription(html).description, description);
    const browser = extractTaskProperties(html);
    assert.equal(browser.title, server.title);
    assert.equal(browser.description, description);
    assert.equal(browser.priority.priority_index, 2);
    assert.equal(browser.estimate.estimate_index, 3);
  } finally {
    global.DOMParser = previous;
  }
});
