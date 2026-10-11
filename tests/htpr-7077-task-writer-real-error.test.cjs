const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const properties = load(path.join(root, "src/app/api/ai/_lib/taskWriterProperties.ts"));
const failure = load(path.join(root, "src/utils/helperFunctions/describeTaskWriterFailure.ts"));
const { SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE } = load(path.join(root, "src/lib/aiAllowancePolicy.ts"));
const flagName = "htpr-7077-task-writer-real-error";
const genericMessage = "Could not write this task, try again";

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

async function post({ enabled = true, validate = true, output = "", error } = {}) {
  const checks = [];
  const stubs = {
    ai: { streamText: (args) => {
      // The real package reports stream errors to onError and drops them from textStream.
      if (error) args.onError?.({ error });
      return { textStream: (async function* () { if (output) yield output; })() };
    } },
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/flags": { HTPR_7077_TASK_WRITER_REAL_ERROR_FLAG: flagName, isFeatureEnabled: async (flag, userId) => { checks.push([flag, userId]); return enabled; } },
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
      prepareTaskWriterRun: async () => ({ selected: { model: {}, settings: {} }, instructions: "", messages: [], validateDraft: validate }),
    },
    "@/lib/errors/reportError": { reportError: async () => {} },
  };
  const route = moduleWithStubs("src/app/api/ai/task-writer/route.ts", stubs);
  const response = await route.POST({ json: async () => ({ projectId: 7077, PROMPT: "Write a task", aiMode: "AiTaskWriter" }) });
  return { content: await response.text(), checks };
}

async function main() {
  const providerError = new Error("Provider is overloaded, try again in a minute");
  const cases = [[allowanceError(), SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE], [providerError, providerError.message]];
  for (const [error, expected] of cases) {
    for (const validate of [true, false]) {
      const on = await post({ error, validate });
      assert.match(on.content, /event: error/);
      assert.ok(on.content.includes(expected), on.content);
      assert.ok(on.content.includes("task-writer-stream-error"));
      assert.equal(on.content.includes(genericMessage), false);
      assert.deepEqual(on.checks.find(([flag]) => flag === flagName), [flagName, 985]);
      // The client shows this frame's text instead of the raw event stream.
      assert.equal(failure.describeTaskWriterStreamFailure(on.content), expected);
    }
    const off = await post({ error, enabled: false });
    assert.ok(off.content.includes(genericMessage));
    assert.equal(off.content.includes("task-writer-stream-error"), false);
    const offWithoutValidation = await post({ error, enabled: false, validate: false });
    assert.equal(offWithoutValidation.content.includes("event: error"), false);
  }
  const normal = '<h1 id="ai-generated-task-title">Task</h1><p>Do the thing.</p>';
  assert.equal((await post({ output: normal })).content, normal);
  assert.equal((await post({ output: normal, error: providerError })).content, normal);
  assert.ok((await post({})).content.includes(genericMessage));
  console.log("HTPR-7077 tests passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
