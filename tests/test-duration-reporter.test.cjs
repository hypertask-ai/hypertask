const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const reporterPath = path.resolve(__dirname, "../scripts/test-duration-reporter.mjs");

test("reporter emits whole-file completion once, not nested test or suite durations", async () => {
  const { default: reporter } = await import(reporterPath);
  const file = path.resolve("tests/example.test.cjs");
  async function* events() {
    yield { type: "test:complete", data: { nesting: 0, file, name: "suite", details: { duration_ms: 900 } } };
    yield { type: "test:complete", data: { nesting: 1, file, name: file, details: { duration_ms: 800 } } };
    yield { type: "test:pass", data: { nesting: 0, file, name: file, details: { duration_ms: 1250 } } };
    yield { type: "test:summary", data: { file, duration_ms: 1100 } };
    yield { type: "test:complete", data: { nesting: 0, file, name: file, entryFile: file, details: { duration_ms: 700 } } };
    yield { type: "test:complete", data: { nesting: 0, file, name: "tests/example.test.cjs", details: { duration_ms: 1250 } } };
  }
  let output = "";
  for await (const chunk of reporter(events())) output += chunk;
  assert.deepEqual(output.split("\n").filter(Boolean).map(JSON.parse), [
    { file: "tests/example.test.cjs", durationMs: 1250 },
  ]);
});

test("real Node events capture nested, failing, empty and timed-out files without losing spec stdout", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "duration-reporter-test-"));
  try {
    const sources = {
      "nested.cjs": `const { test } = require('node:test'); test('parent', async t => { await t.test('child', () => {}); });`,
      "failed.cjs": `require('node:test')('broken', () => { throw Error('expected fixture failure'); });`,
      "crashed.cjs": `process.exit(3);`,
      "empty.cjs": `console.log('empty fixture ran');`,
      "filename.cjs": `require('node:test')(__filename, () => {});`,
      "timeout.cjs": `require('node:test')('hung', t => new Promise(() => { const timer = setInterval(() => {}, 1000); t.signal.addEventListener('abort', () => clearInterval(timer)); }));`,
    };
    for (const [file, source] of Object.entries(sources)) writeFileSync(path.join(directory, file), source);
    const destination = path.join(directory, "durations.jsonl");
    const result = spawnSync(process.execPath, [
      "--test", "--test-concurrency=2", "--test-timeout=2000",
      "--test-reporter=spec", "--test-reporter-destination=stdout",
      `--test-reporter=${reporterPath}`, `--test-reporter-destination=${destination}`,
      ...Object.keys(sources),
    ], { cwd: directory, env: { ...process.env, NODE_TEST_CONTEXT: undefined }, encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /parent/);
    assert.match(result.stdout, /expected fixture failure/);
    assert.match(result.stdout, /empty fixture ran/);
    const durations = readFileSync(destination, "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(durations.map(({ file }) => file).sort(), Object.keys(sources).sort());
    for (const { durationMs } of durations) assert.ok(Number.isFinite(durationMs) && durationMs > 0);
    assert.ok(durations.find(({ file }) => file === "timeout.cjs").durationMs >= 1800);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
