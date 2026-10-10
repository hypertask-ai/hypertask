const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const properties = load(path.join(root, "src/app/api/ai/_lib/taskWriterProperties.ts"));
const { SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE } = load(path.join(root, "src/lib/aiAllowancePolicy.ts"));
const realErrorFlag = "htpr-7077-task-writer-real-error";
const skipFlag = "htpr-7086-skip-allowance-report";

function moduleWithStubs(file, stubs) {
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports,
    require: (id) => (id in stubs ? stubs[id] : id.startsWith("@/") || id.startsWith("./") ? {} : require(id)),
    ReadableStream, Response, TextEncoder, TextDecoder, Error, AbortController,
    console: { log() {}, warn() {}, error() {} },
  }, { filename });
  return loadedModule.exports;
}

function allowanceError() {
  const error = new Error(SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE);
  error.name = "SharedAiAllowanceExceededError";
  return error;
}

async function post({ skipEnabled = true, error } = {}) {
  const reports = [];
  const stubs = {
    ai: { streamText: (args) => {
      args.onError?.({ error });
      return { textStream: (async function* () {})() };
    } },
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/flags": {
      HTPR_7077_TASK_WRITER_REAL_ERROR_FLAG: realErrorFlag,
      HTPR_7086_SKIP_ALLOWANCE_REPORT_FLAG: skipFlag,
      isFeatureEnabled: async (flag) => flag === realErrorFlag || skipEnabled,
    },
    "@/lib/aiAllowancePolicy": { SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE },
    "@/app/api/ai/_lib/editorAi": {
      errorMessage: (caught) => caught.message,
      sseFrame: (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
      SSE_HEADERS: {}, filterOneImagePass: (text) => ({ emit: text, leftover: "" }),
    },
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {} },
    "@/app/api/ai/_lib/taskWriterProperties": properties,
    "@/app/api/ai/_lib/requestUser": { getAiRequestUser: async () => ({ id: 985 }) },
    "@/app/api/ai/_lib/taskWriterRun": {
      missingRequiredFields: () => false,
      taskWriterRequestSchema: { parse: (body) => body },
      prepareTaskWriterRun: async () => ({ selected: { model: {}, settings: {} }, instructions: "", messages: [], validateDraft: true }),
    },
    "@/lib/errors/reportError": { reportError: async (payload) => { reports.push(payload); } },
  };
  const route = moduleWithStubs("src/app/api/ai/task-writer/route.ts", stubs);
  const response = await route.POST({ json: async () => ({ projectId: 7086, PROMPT: "Write a task", aiMode: "AiTaskWriter" }) });
  return { content: await response.text(), reports };
}

async function main() {
  const limit = await post({ error: allowanceError() });
  assert.ok(limit.content.includes(SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE), limit.content);
  assert.ok(limit.content.includes("task-writer-stream-error"));
  assert.equal(limit.reports.length, 0);

  // With the flag off the old reporting stays.
  const limitFlagOff = await post({ error: allowanceError(), skipEnabled: false });
  assert.ok(limitFlagOff.content.includes(SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE));
  assert.equal(limitFlagOff.reports.length, 1);

  const providerError = new Error("Provider is overloaded, try again in a minute");
  const other = await post({ error: providerError });
  assert.ok(other.content.includes(providerError.message));
  assert.ok(other.content.includes("task-writer-stream-error"));
  assert.equal(other.reports.length, 1);
  assert.equal(other.reports[0].extra.stage, "stream-empty");
  console.log("HTPR-7086 tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
