const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const { chatRequestSchema } = jiti(path.join(root, "src/lib/ai/chatStream/request.ts"));
const { SSE_HEADERS } = jiti(path.join(root, "src/lib/ai/tools/constants.ts"));
const { toErrorMessage } = jiti(path.join(root, "src/lib/api/errorMessage.ts"));

function load(relativePath, dependencies, logger) {
  const filename = path.join(root, relativePath);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded,
    exports: loaded.exports,
    require: (id) => dependencies[id] ?? {},
    Response, console: logger, Error, SyntaxError,
  }, { filename });
  return loaded.exports;
}

function harness() {
  const logs = { error: [], warn: [], info: [] };
  const logger = Object.fromEntries(Object.keys(logs).map((level) => [level, (...args) => logs[level].push(args)]));
  const errors = load("src/lib/ai/chatStream/errors.ts", {
    zod: require("zod"),
    "@/lib/api/errorMessage": { toErrorMessage },
    "@/lib/ai/tools/constants": { SSE_HEADERS },
  }, logger);
  let sidebarCalls = 0;
  const route = load("src/app/api/ai/chat/stream/route.ts", {
    "@/app/api/ai/_lib/requestUser": { getAiRequestUser: async () => ({ id: 985 }) },
    "@/lib/ai/chatStream/errors": errors,
    "@/lib/ai/chatStream/request": { chatRequestSchema },
    "@/lib/agents/chatAccess": {
      loadSidebarChatRequest: async () => {
        sidebarCalls += 1;
        return { ok: false, error: "Sidebar access refused", status: 403 };
      },
    },
  }, logger);
  return { logs, errors, route, sidebarCalls: () => sidebarCalls };
}

for (const body of ["private-client-input", null, [], { message: "" }, { message: "hello", session_id: "not-a-uuid" }]) {
  test(`POST rejects invalid chat input without server errors: ${JSON.stringify(body)}`, async () => {
    const { route, logs, sidebarCalls } = harness();
    const response = await route.POST(new Request("https://example.test/api/ai/chat/stream", {
      method: "POST", body: JSON.stringify(body),
    }));
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    assert.match(text, /^event: error\ndata: \{"content":"Invalid request/);
    assert.match(text, /event: done\ndata: \{"status":"error"\}/);
    assert.doesNotMatch(text, /private-client-input|ZodError|invalid_type/);
    assert.equal(sidebarCalls(), 0);
    assert.equal(logs.error.length, 0);
    assert.deepEqual(logs.info, [["[ai/chat/stream] request-validation refused: invalid request"]]);
  });
}

test("a valid POST still passes validation and reaches sidebar authorization", async () => {
  const { route, logs, sidebarCalls } = harness();
  const response = await route.POST(new Request("https://example.test/api/ai/chat/stream", {
    method: "POST", body: JSON.stringify({ message: "hello" }),
  }));
  assert.equal(response.status, 403);
  assert.match(await response.text(), /Sidebar access refused/);
  assert.equal(sidebarCalls(), 1);
  assert.equal(logs.error.length + logs.info.length, 0);
});

test("a real model failure is still logged as an error", () => {
  const { errors, logs } = harness();
  const failure = new Error("provider failed");
  assert.equal(errors.userFacingErrorMessage(failure, "model-stream"),
    "Sorry, something went wrong while generating a response. Please try again.");
  assert.equal(logs.error.length, 1);
  assert.equal(logs.error[0][1], failure);
  assert.equal(logs.info.length, 0);
});

test("unexpected validation failures remain visible as server errors", () => {
  const { errors, logs } = harness();
  const failure = new Error("unexpected validator failure");
  assert.equal(errors.requestErrorMessage(failure, "validation"), "Invalid request.");
  assert.equal(logs.error.length, 1);
  assert.equal(logs.error[0][1], failure);
  assert.equal(logs.info.length, 0);
});

for (const body of ["{", '{"message":', ""]) {
  test(`POST refuses malformed JSON without server errors: ${JSON.stringify(body)}`, async () => {
    const { route, logs, sidebarCalls } = harness();
    const response = await route.POST(new Request("https://example.test/api/ai/chat/stream", {
      method: "POST", body,
    }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    assert.equal(await response.text(),
      'event: error\ndata: {"content":"Invalid request: the request body could not be read."}\n\n' +
      'event: done\ndata: {"status":"error"}\n\n');
    assert.equal(sidebarCalls(), 0);
    assert.deepEqual(logs.error, []);
    assert.deepEqual(logs.info, [["[ai/chat/stream] request-body refused: invalid JSON"]]);
  });
}

test("unexpected body read failures remain visible as server errors", async () => {
  const { route, logs, sidebarCalls } = harness();
  const failure = new Error("private body reader failure");
  const response = await route.POST({ json: async () => { throw failure; } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Invalid request: the request body could not be read\./);
  assert.equal(sidebarCalls(), 0);
  assert.equal(logs.error.length, 1);
  assert.equal(logs.error[0][1], failure);
  assert.deepEqual(logs.info, []);
});
