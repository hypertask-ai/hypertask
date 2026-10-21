const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const utils = path.resolve(__dirname, "../src/lib/mcp-server/utils");

function load(name) {
  const file = path.join(utils, `${name}.ts`);
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = new Module(file);
  mod.filename = file;
  mod._compile(js, file);
  return mod.exports;
}

const { logger } = load("logger");
const errors = load("errors");

function streamFor(error) {
  const original = { error: console.error, warn: console.warn };
  const calls = [];
  console.error = (line) => calls.push(["error", JSON.parse(line)]);
  console.warn = (line) => calls.push(["warn", JSON.parse(line)]);
  try {
    logger.failure("Failed to search tasks", error, { correlationId: "c1" });
  } finally {
    Object.assign(console, original);
  }
  assert.equal(calls.length, 1);
  return calls[0];
}

test("a search for a board the caller cannot see is a warning, not an error (HTPR-7255)", () => {
  const [stream, entry] = streamFor(errors.mapHttpErrorToMcpError(404, "Project not found or access denied", "c1"));
  assert.equal(stream, "warn");
  assert.equal(entry.level, "warn");
  assert.equal(entry.message, "Failed to search tasks");
  assert.equal(entry.error, "Project not found or access denied");
  assert.equal(entry.correlationId, "c1");
});

test("every caller mistake is a warning", () => {
  for (const status of [400, 401, 403, 404, 409, 429]) {
    assert.equal(streamFor(errors.mapHttpErrorToMcpError(status, `HTTP ${status}`))[0], "warn", String(status));
  }
});

test("server failures and unknown errors still go to the error stream", () => {
  assert.equal(streamFor(errors.mapHttpErrorToMcpError(500, "HTTP 500: Internal Server Error"))[0], "error");
  assert.equal(streamFor(errors.mapHttpErrorToMcpError(503, "HTTP 503"))[0], "error");
  assert.equal(streamFor(new errors.ApiError("no status"))[0], "error");
  assert.equal(streamFor(new Error("database down"))[0], "error");
  assert.equal(streamFor("string failure")[1].error, "string failure");
});

test("MCP services log caught failures through the shared helper", () => {
  const services = path.resolve(__dirname, "../src/lib/mcp-server/lib/services");
  for (const name of fs.readdirSync(services)) {
    const source = fs.readFileSync(path.join(services, name), "utf8");
    assert.doesNotMatch(source, /logger\.error\('Failed to/, name);
  }
  assert.match(fs.readFileSync(path.join(services, "search.service.ts"), "utf8"), /logger\.failure\('Failed to search tasks', error,/);
});
