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
const key = "htpr-7060-task-writer-empty-and-research";
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

function harness({ enabled = true, output = "", boardResearch = false, finishReason = "stop", mode = "task_writer" } = {}) {
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
      project: { findFirst: async () => ({ id: 7060, section: [], labels: [] }) },
      taskTemplate: { findMany: async () => [] }, section: { findMany: async () => [] },
    } },
    "@/lib/flags": { HTPR_7060_TASK_WRITER_EMPTY_AND_RESEARCH_FLAG: key, isFeatureEnabled: async (flag, userId) => {
      checks.push([flag, userId]);
      return flag === key ? enabled : flag === "board-research" && boardResearch;
    } },
    "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}) },
    "@/lib/ai/composeTaskTarget": {}, "@/lib/doneColumns": { doneColumnTitles: () => new Set() },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { searchTasks: async () => [] },
    "@/app/api/ai/_lib/editorAi": editor,
    "@/app/api/ai/_lib/taskWriterPrompt": prompt,
    "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async () => ({ settings: {} }) },
    "@/app/api/ai/_lib/skills": { resolveSkills: async (text) => ({ cleanedText: text, systemPromptAddition: "Fixture skill", skills: [] }) },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "", resolveAiUsageTaskId: async () => null },
    "@/app/api/ai/_lib/taskWriterBoardResearch": {
      HTPR_6363_TASK_WRITER_RESEARCH_FLAG: "board-research", TASK_WRITER_BOARD_RESEARCH_RULES: "Fixture board research",
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
  };
  async function post(kind) {
    const route = moduleWithStubs(kind === "app" ? "src/app/api/ai/task-writer/route.ts" : "src/app/api/mcp/ai/task-writer/route.ts", stubs);
    const body = kind === "mcp" ? { project_id: 7060, prompt: "Analyze Paperclip", mode }
      : { projectId: 7060, PROMPT: "Analyze Paperclip", aiMode: mode === "task_writer" ? "AiTaskWriter" : "WriteWithAI" };
    const response = await route.POST({ json: async () => body });
    return { status: response.status, content: await response.text() };
  }
  return { post, checks, calls };
}

async function clientError(content) {
  const states = [];
  const hook = moduleWithStubs("src/hooks/MultiPages/AiWriter/useAiTaskWriter.ts", {
    react: { useState: (initial) => {
      const state = { value: initial }; states.push(state);
      return [initial, (value) => { state.value = typeof value === "function" ? value(state.value) : value; }];
    }, useRef: (current) => ({ current }), useEffect() {}, useCallback: (fn) => fn },
    "@/hooks/General/useCurrentBoardBilling": { useCurrentBoardBilling: () => null },
    "@/lib/byokSelectedProviderGate": { shouldBlockAiDueToByokProvider: () => false },
    "@/utils/helperFunctions/helperFunctions": {}, "@/utils/helperFunctions/getFileTypeFromUrl": {},
    "@/lib/constants/APIRouteConstants": { taskWriterRoute: "/api/ai/task-writer" },
    "@/utils/helperFunctions/describeTaskWriterFailure": failure,
    "@/lib/ai/taskWriterMedia": {
      createTaskWriterMediaTokenFactory: () => () => "", extractTaskWriterMedia: (html) => ({ html, media: [] }),
      extractTaskWriterPromptMedia: (html) => ({ html, media: [] }), maskTaskWriterMedia: (html) => html,
    },
    "@/lib/ai/taskWriterTaskIds": { getTaskWriterTaskIds: () => [] },
    "@/lib/ai/taskWriterBoardContext": { buildTaskWriterRequestScope: () => ({ projectId: 7060 }) },
  }, {
    DOMParser: class { parseFromString() { return { querySelectorAll: () => [] }; } },
    fetch: async () => new Response(new ReadableStream({ start(controller) {
      for (const character of content) controller.enqueue(new TextEncoder().encode(character));
      controller.close();
    } })),
  }).default;
  await hook({ id: 7060 }, {}, "AiTaskWriter").sendAIRequest("Analyze Paperclip");
  return { response: states[1].value, hasError: states[3].value };
}

async function main() {
  const normal = '<h1 id="ai-generated-task-title">Research Paperclip</h1><p>Investigate its workflows.</p>';
  for (const kind of ["app", "mcp"]) {
    for (const output of ["", " \n\t ", "<p> &nbsp; </p>", "<p><br></p>", '<h1 id="ai-generated-task-title">Research</h1>', '<h1 id="ai-generated-task-title">Research', '<h1 id="ai-generated-task-title">Research</h1><p>Proposed properties: Priority Medium</p>', '<img src="invented.png">']) {
      for (const finishReason of ["stop", "length"]) {
        const h = harness({ output, finishReason });
        const r = await h.post(kind);
        if (kind === "mcp") {
          assert.equal(r.status, 500);
          const json = JSON.parse(r.content);
          assert.equal(json.success, false);
          assert.equal(json.error, message);
        } else {
          assert.match(r.content, /event: error/);
          assert.ok(r.content.includes(message));
          assert.deepEqual(await clientError(r.content), { response: message, hasError: true });
        }
        assert.deepEqual(h.checks.find(([flag]) => flag === key), [key, 985]);
      }
      const off = await harness({ enabled: false, output }).post(kind);
      assert.equal(off.status, 200);
      if (kind === "mcp") assert.equal(JSON.parse(off.content).success, true);
      else assert.equal(off.content.includes("event: error"), false);
    }
    for (const mode of ["task_writer", "write_with_ai"]) {
      for (const enabled of [false, true]) {
        const h = harness({ enabled, output: normal, mode });
        const r = await h.post(kind);
        assert.equal(r.status, 200);
        assert.equal(h.calls[0].instructions.includes("RESEARCH REQUESTS"), enabled && mode === "task_writer");
        if (kind === "mcp") assert.equal(JSON.parse(r.content).success, true);
        else assert.equal(r.content, normal);
        const error = await harness({ output: "", mode }).post(kind);
        assert.ok(error.content.includes(message));
      }
    }
    for (const boardResearch of [false, true]) {
      for (const enabled of [false, true]) {
        const h = harness({ enabled, boardResearch, output: normal });
        await h.post(kind);
        const instructions = h.calls[0].instructions;
        assert.equal(instructions.includes("RESEARCH REQUESTS"), enabled);
        if (enabled) {
          assert.match(instructions, /goal, questions, sources, deliverable, and acceptance criteria/);
          assert.match(instructions, /Never perform the research or state findings, rankings, or facts the user did not provide/);
        }
        assert.equal(h.calls[0].maxOutputTokens, 16000);
      }
    }
  }
  assert.deepEqual(await clientError(normal), { response: normal, hasError: false });
  // Existing error handling is unchanged for streams from the flag-off server.
  const oldError = 'event: error\ndata: {"type":"error","content":"Old error"}\n\n';
  assert.deepEqual(await clientError(oldError), { response: oldError, hasError: false });
  console.log("HTPR-7060 tests passed");
}
main().catch((error) => {
  console.error(`HTPR-7060 tests failed (${error.name})`);
  console.error(String(error.stack).split("\n").filter((line) => /^\s+at /.test(line)).join("\n"));
  process.exitCode = 1;
});
