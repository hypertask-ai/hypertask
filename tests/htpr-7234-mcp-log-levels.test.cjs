const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

function loadLogger() {
  return loadModule("src/lib/mcp-server/utils/logger.ts").logger;
}

function captureConsole(run) {
  const methods = ["error", "warn", "info", "debug", "log"];
  const original = Object.fromEntries(methods.map((m) => [m, console[m]]));
  const calls = [];
  for (const m of methods) console[m] = (line) => calls.push({ stream: m, entry: JSON.parse(line) });
  try {
    run();
  } finally {
    Object.assign(console, original);
  }
  return calls;
}

test("a successful info message is not written to the error stream", () => {
  const logger = loadLogger();
  const calls = captureConsole(() => logger.info("Files attached successfully", { count: 1 }));
  assert.deepEqual(calls.map((c) => c.stream), ["info"]);
  assert.equal(calls[0].entry.message, "Files attached successfully");
  assert.equal(calls[0].entry.level, "info");
});

test("each level goes to its own console stream and real errors stay on the error stream", () => {
  const logger = loadLogger();
  logger.setLevel("debug");
  const calls = captureConsole(() => {
    logger.error("Upload failed");
    logger.warn("Auth event: authz_denied");
    logger.info("Tool invocation");
    logger.debug("details");
  });
  assert.deepEqual(
    calls.map((c) => [c.stream, c.entry.level]),
    [["error", "error"], ["warn", "warn"], ["info", "info"], ["debug", "debug"]],
  );
});

test("levels below the configured threshold are still dropped", () => {
  const logger = loadLogger();
  const calls = captureConsole(() => logger.debug("hidden"));
  assert.deepEqual(calls, []);
});
