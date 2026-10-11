const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const prompt = load(path.join(root, "src/app/api/ai/_lib/taskWriterPrompt.ts"));
const promptParts = load(path.join(root, "src/app/api/ai/_lib/editorAiPrompts.ts"));
const properties = load(path.join(root, "src/app/api/ai/_lib/taskWriterProperties.ts"));
const failure = load(path.join(root, "src/utils/helperFunctions/describeTaskWriterFailure.ts"));
const key = "htpr-7123-writer-ticket-type";
const message = "Could not write this task, try again";

function moduleWithStubs(file, stubs, globals = {}) {
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports,
    require: (id) => {
      if (id in stubs) return stubs[id];
      if (id.startsWith("@/") || id.startsWith("./")) return {};
      return require(id);
    },
    ReadableStream, Response, TextEncoder, TextDecoder, Error, AbortController,
    console: { log() {}, warn() {}, error() {} }, ...globals,
  }, { filename });
  return loadedModule.exports;
}

function harness({ enabled = true, output = "", finishReason = "stop", mode = "task_writer", requestKind } = {}) {
  const checks = [], calls = [];
  const editor = {
    ...moduleWithStubs("src/app/api/ai/_lib/editorAi.ts", {}),
    ...promptParts,
    selectTaskWriterModel: async () => ({ model: {}, modelId: "fixture-model", usageProvider: "fixture", settings: { maxOutputTokens: 16000 } }),
    retrieveTaskWriterContext: async () => "", createDocumentAttachmentSummary: () => "",
    createTaskWriterUserContent: (text) => text,
    sseFrame: (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    SSE_HEADERS: {}, errorMessage: (error) => error.message,
  };
  const run = moduleWithStubs("src/app/api/ai/_lib/taskWriterRun.ts", {
    "@/lib/prisma": { __esModule: true, default: {
      project: { findFirst: async () => ({ id: 7123, section: [], labels: [] }) },
      taskTemplate: { findMany: async () => [] }, section: { findMany: async () => [] },
    } },
    "@/lib/flags": { HTPR_7123_WRITER_TICKET_TYPE_FLAG: key, HTPR_6929_COMPOSE_TASK_WRITER_FLAG: "htpr-6929-compose-task-writer",isFeatureEnabled: async (flag, userId) => {
      checks.push([flag, userId]);
      if (flag === "htpr-6929-compose-task-writer") return true;
      return flag === key ? enabled : false;
    } },
    "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}) },
    "@/lib/ai/composeTaskTarget": {}, "@/lib/doneColumns": { doneColumnTitles: () => new Set() },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { searchTasks: async () => [] },
    "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async (_userId, args) => `${args.fixed}${args.suffix ?? ""}` },
    "@/app/api/ai/_lib/editorAi": editor,
    "@/app/api/ai/_lib/taskWriterPrompt": prompt,
    "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async () => ({ settings: {} }) },
    "@/app/api/ai/_lib/skills": { resolveSkills: async (text) => ({ cleanedText: text, systemPromptAddition: "Fixture skill", skills: [] }) },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "", resolveAiUsageTaskId: async () => null },
    "@/app/api/ai/_lib/taskWriterBoardResearch": {
      TASK_WRITER_BOARD_RESEARCH_RULES: "Fixture board research",
      buildTaskWriterRetrievalQuery: ({ prompt }) => prompt,
      formatRelatedTicketCandidates: () => "", formatBoardVocabulary: () => "",
    },
    "@/app/api/ai/_lib/boardTemplateContext": { BOARD_TEMPLATE_LIMIT: 10 },
  });
  const stubs = {
    ai: {
      generateText: async (args) => { calls.push(args); return { text: output, finishReason }; },
      streamText: (args) => { calls.push(args); return { textStream: (async function* () {
        for (let i = 0; i < output.length; i += 3) yield output.slice(i, i + 3);
      })(), finishReason: Promise.resolve(finishReason) }; },
    },
    "next/server": { NextResponse: { json: Response.json } },
    "@/app/api/ai/_lib/editorAi": editor,
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {} },
    "@/app/api/ai/_lib/taskWriterRun": run,
    "@/app/api/ai/_lib/taskWriterProperties": properties,
    "@/app/api/ai/_lib/requestUser": { getAiRequestUser: async () => ({ id: 985 }) },
    "@/lib/mcp/routeWrapper": { wrapMcpRoute: (handler) => handler, validateMcpRouteAuth: async () => ({ user: { id: 985 } }), checkMcpRouteRateLimit: async () => null },
    "@/lib/mcp/auth": {}, "@/lib/ai/taskWriterDuplicateGuard": { taskTitleFromBrief: () => "Research Paperclip" },
    "@/lib/errors/reportError": { reportError: async () => {} },
    "@/lib/ai/taskWriterTicketType": load(path.join(root, "src/lib/ai/taskWriterTicketType.ts")),
  };
  async function post(kind) {
    const route = moduleWithStubs(kind === "app" ? "src/app/api/ai/task-writer/route.ts" : "src/app/api/mcp/ai/task-writer/route.ts", stubs);
    const body = kind === "mcp" ? { project_id: 7123, prompt: "Analyze Paperclip", mode }
      : { projectId: 7123, PROMPT: "Analyze Paperclip", aiMode: mode === "task_writer" ? "AiTaskWriter" : "WriteWithAI", ...(requestKind ? { requestKind } : {}) };
    const response = await route.POST({ json: async () => body });
    return { status: response.status, content: await response.text(), headers: response.headers };
  }
  return { post, checks, calls };
}

const test = require("node:test");

const draft = '<h1 id="ai-generated-task-title">Agents react with emoji</h1><p>Agents should react.</p>';
const RULE = "TICKET TYPE (bug, improvement, feature)";

async function instructionsFor(options) {
  const h = harness({ output: draft, ...options });
  await h.post("app");
  return h.calls[0].instructions;
}

test("flag on adds the ticket type rule that separates defects from improvements", async () => {
  const on = await instructionsFor({ enabled: true });
  assert.ok(on.includes(RULE));
  assert.match(on, /A bug is a defect/);
  assert.match(on, /new or better behavior is an improvement/);
  assert.match(on, /Never label it a bug/);
  assert.match(on, /unsure[^.]*do not call it a bug/);
  assert.match(on, /"Problem" heading and the Tags and Status examples[^.]*never mean the ticket is a bug/);
});

test("flag off leaves the instructions exactly as before", async () => {
  const off = await instructionsFor({ enabled: false });
  const on = await instructionsFor({ enabled: true });
  assert.ok(!off.includes(RULE));
  assert.equal(on, `${off}\n\n${prompt.TASK_WRITER_TICKET_TYPE_RULE}`);
});

test("the rule goes into the suffix only, so the cached fixed part is identical on and off", () => {
  const run = fs.readFileSync(path.join(root, "src/app/api/ai/_lib/taskWriterRun.ts"), "utf8");
  assert.match(run, /isFeatureEnabled\(HTPR_7123_WRITER_TICKET_TYPE_FLAG, userId\)\)\) \{\s*suffix \+=/);
  assert.match(run, /fixed: fixedInstructions,/);
});

test("the rule applies to the AI Task Writer only", async () => {
  const h = harness({ enabled: true, output: draft, mode: "write" });
  await h.post("app");
  assert.ok(!h.calls[0].instructions.includes(RULE));
});

test("a defect stays a bug, while an improvement or feature gets no bug label or Bugs column", () => {
  const rule = prompt.TASK_WRITER_TICKET_TYPE_RULE;
  assert.match(rule, /used to work, or should work according to existing behavior, and does not/);
  assert.match(rule, /Only a defect may get the bug label or a Bugs column/);
  assert.match(rule, /never put it in a Bugs column/);
  assert.match(rule, /improvement or feature label or column when the board has one/);
});

test("Ctrl+J compose path: sends AiTaskWriter with compose-task and gets the rule when the flag is on", async () => {
  const compose = fs.readFileSync(path.join(root, "src/lib/ai/composeTask.ts"), "utf8");
  assert.match(compose, /aiMode: "AiTaskWriter",\s*requestKind: "compose-task"/);
  const on = harness({ enabled: true, output: draft, requestKind: "compose-task" });
  await on.post("app");
  assert.ok(on.calls[0].instructions.includes(RULE));
  const off = harness({ enabled: false, output: draft, requestKind: "compose-task" });
  await off.post("app");
  assert.ok(!off.calls[0].instructions.includes(RULE));
});

test("Ctrl+J compose path: only the validated ticket type can move the column, never the model's status or tags", () => {
  const compose = fs.readFileSync(path.join(root, "src/lib/ai/composeTask.ts"), "utf8");
  assert.doesNotMatch(compose, /ai-generated-task-(status|tags)/);
  assert.match(compose, /typedSection \? typedSection\.id : defaults\?\.data\.sectionId/);
  assert.match(compose, /\.\.\.taskFields/);
});

const MARKER = "TICKET TYPE MARKER";
const typeSpan = (value) => `<span id="ai-generated-task-type" style="display:none">${value}</span>`;

test("compose-task with the flag on asks for the type marker and announces it with a header", async () => {
  const h = harness({ enabled: true, output: draft + typeSpan("improvement"), requestKind: "compose-task" });
  const r = await h.post("app");
  assert.ok(h.calls[0].instructions.includes(MARKER));
  assert.equal(r.headers.get("X-Task-Writer-Ticket-Type"), "enabled");
  assert.ok(r.content.endsWith(typeSpan("improvement")));
});

test("the server keeps only a valid type and drops junk, so compose never sees one", async () => {
  const junk = await harness({ enabled: true, output: draft + typeSpan("chore"), requestKind: "compose-task" }).post("app");
  assert.ok(!junk.content.includes("ai-generated-task-type"));
  assert.ok(junk.content.startsWith('<h1 id="ai-generated-task-title">Agents react with emoji</h1>'));
  const none = await harness({ enabled: true, output: draft, requestKind: "compose-task" }).post("app");
  assert.equal(none.content, draft);
  const messy = await harness({ enabled: true, output: draft + typeSpan("Bug") + typeSpan("feature"), requestKind: "compose-task" }).post("app");
  assert.ok(messy.content.endsWith(typeSpan("bug")));
  assert.equal(messy.content.split("ai-generated-task-type").length - 1, 1);
});

test("flag off or not a compose request: no marker prompt, no header, output untouched", async () => {
  const off = harness({ enabled: false, output: draft + typeSpan("improvement"), requestKind: "compose-task" });
  const offResult = await off.post("app");
  assert.ok(!off.calls[0].instructions.includes(MARKER));
  assert.equal(offResult.headers.get("X-Task-Writer-Ticket-Type"), null);
  assert.equal(offResult.content, draft + typeSpan("improvement"));
  const manual = harness({ enabled: true, output: draft });
  const manualResult = await manual.post("app");
  assert.ok(!manual.calls[0].instructions.includes(MARKER));
  assert.equal(manualResult.headers.get("X-Task-Writer-Ticket-Type"), null);
});

test("flag is a bugfix flag that defaults to Everyone", () => {
  const source = fs.readFileSync(path.join(root, "src/lib/flags/definitions/htpr-7123-writer-ticket-type.ts"), "utf8");
  assert.match(source, /kind: "bugfix"/);
  assert.ok(!/defaultMode/.test(source));
  assert.match(source, /releaseRisk/);
});
