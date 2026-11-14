const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const webpack = require("webpack");
const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft");
const { BuildMemoryPlugin } = require("../scripts/build-memory-plugin.cjs");
const root = path.resolve(__dirname, "..");

for (const broken of [false, true]) {
  test(`memory reporting preserves a ${broken ? "failed" : "successful"} compilation`, async (t) => {
    const directory = mkdtempSync(path.join(root, ".build-memory-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const entry = path.join(directory, "entry.cjs");
    writeFileSync(entry, broken ? 'require("./missing.cjs")' : "module.exports = 42");
    const compiler = webpack({
      name: "memory-fixture",
      mode: "production",
      target: "node",
      entry,
      output: { path: path.join(directory, "out"), filename: "result.cjs", library: { type: "commonjs2" } },
      plugins: [new BuildMemoryPlugin()],
    });
    const logs = [];
    const original = console.log;
    t.mock.method(console, "log", (...args) => {
      if (args[0] === "[build-memory]") logs.push(JSON.parse(args[1]));
      else original(...args);
    });
    const stats = await new Promise((resolve, reject) => compiler.run((error, result) => error ? reject(error) : resolve(result)));
    await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
    assert.equal(stats.hasErrors(), broken, stats.toString({ all: false, errors: true }));
    if (!broken) assert.equal(require(path.join(directory, "out/result.cjs")), 42);
    assert.equal(logs[0].phase, "start");
    assert.equal(logs.at(-1).phase, "done");
    assert.ok(logs.some(row => row.phase === "modules"));
    assert.ok(logs.some(row => row.phase === "assets"));
    for (const row of logs) {
      assert.equal(row.compiler, "memory-fixture");
      assert.equal(row.pid, process.pid);
      assert.ok(row.sampledHeapPeakMiB >= row.heapUsedMiB && row.heapUsedMiB > 0);
      assert.ok(row.processMaxRssMiB > 0 && row.rssMiB > 0);
    }
  });
}

test("a fatal compiler error still stops memory reporting", async (t) => {
  const compiler = webpack({ mode: "production", plugins: [new BuildMemoryPlugin()] });
  compiler.hooks.beforeRun.tap("FatalFixture", () => { throw new Error("fatal-memory-fixture"); });
  const phases = [];
  t.mock.method(console, "log", (prefix, json) => {
    if (prefix === "[build-memory]") phases.push(JSON.parse(json).phase);
  });
  const error = await new Promise(resolve => compiler.run(resolve));
  await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
  assert.match(error.message, /fatal-memory-fixture/);
  assert.deepEqual(phases, ["start", "failed"]);
});

test("external server SDKs keep their Node exports and traced runtime files", async (t) => {
  const directory = mkdtempSync(path.join(root, ".build-memory-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const entry = path.join(directory, "external.cjs");
  const requests = ["stripe", "posthog-node", "@modelcontextprotocol/sdk/server/mcp.js", "mcp-handler"];
  writeFileSync(entry, `
    const assert = require("node:assert/strict");
    assert.equal(typeof require("stripe"), "function");
    assert.equal(typeof require("posthog-node").PostHog, "function");
    assert.equal(typeof require("@modelcontextprotocol/sdk/server/mcp.js").McpServer, "function");
    assert.equal(typeof require("mcp-handler").createMcpHandler, "function");
    console.log("EXTERNAL_SDK_EXPORTS_OK");
  `);
  const loaded = spawnSync(process.execPath, ["--no-experimental-require-module", entry], {
    cwd: root, encoding: "utf8", timeout: 30_000,
  });
  assert.equal(loaded.status, 0, loaded.stderr || loaded.error?.message);
  assert.match(loaded.stdout, /EXTERNAL_SDK_EXPORTS_OK/);
  const { fileList } = await nodeFileTrace([entry], { base: root, processCwd: root });
  for (const request of requests) {
    assert.ok(fileList.has(path.relative(root, require.resolve(request))), `${request} runtime entry is traced`);
  }
  assert.ok([...fileList].some(file => file.includes("node_modules/stripe/cjs/resources/")));
  assert.ok([...fileList].some(file => file.includes("node_modules/@modelcontextprotocol/sdk/dist/cjs/")));
});
