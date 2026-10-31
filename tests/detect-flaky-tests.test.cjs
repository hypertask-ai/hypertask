const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const testLog = (name) => [
  "2026-10-26T00:00:00Z test at tests/detector-probe.test.cjs:1:1",
  `2026-10-26T00:00:01Z ✖ ${name} (12.5ms)`,
  "2026-10-26T00:00:02Z AssertionError: expected order differs",
  "2026-10-26T00:00:03Z ##[error]Process completed with exit code 1.",
].join("\n");
const infraLog = "2026-10-26T00:00:00Z gh: API rate limit exceeded for installation. (HTTP 403)\n".repeat(4);
const summaryLog = "2026-10-26T00:00:00Z Required CI test shard failed.\n".repeat(6);

function collect({ jobs, logs, differentSha = false }) {
  const cache = mkdtempSync(join(tmpdir(), "flaky-detector-"));
  try {
    const rows = differentSha
      ? [
          `100\t1\tfailure\t${sha}\thttps://github.com/hypertask-ai/hypertask/actions/runs/100`,
          `101\t1\tsuccess\t${otherSha}\thttps://github.com/hypertask-ai/hypertask/actions/runs/101`,
        ]
      : [`100\t2\tsuccess\t${sha}\thttps://github.com/hypertask-ai/hypertask/actions/runs/100`];
    writeFileSync(join(cache, "runs-v2-2026-10-26.tsv"), rows.map((row) => `${row}\t2026-10-26T00:00:00Z\tpull_request\tcompleted\tfixture\n`).join(""));
    writeFileSync(join(cache, "jobs-100-1.json"), JSON.stringify({ jobs }));
    writeFileSync(join(cache, differentSha ? "jobs-101-1.json" : "jobs-100-2.json"), JSON.stringify({ jobs: jobs.map((job) => ({ ...job, conclusion: "success" })) }));
    writeFileSync(join(cache, `diff-${sha}-${otherSha}.txt`), "docs/readme.md\n");
    writeFileSync(join(cache, "logs.json"), JSON.stringify(logs));
    writeFileSync(join(cache, "gh"), `#!${process.execPath}
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const logs = JSON.parse(readFileSync(join(__dirname, "logs.json"), "utf8"));
const endpoint = process.argv.at(-1);
const id = endpoint.match(/actions\\/jobs\\/(\\d+)\\/logs$/)?.[1];
if (!id || !Object.hasOwn(logs, id)) process.exit(2);
process.stdout.write(logs[id]);
`, { mode: 0o700 });
    const env = { ...process.env, FLAKY_CACHE: cache, PATH: `${cache}:${process.env.PATH}` };
    for (const key of Object.keys(env)) {
      if (key.startsWith("NODE_TEST") || key === "NODE_CHANNEL_FD") delete env[key];
    }
    const result = spawnSync(process.execPath, ["scripts/detect-flaky-tests.mjs", "--since", "2026-10-26", "--until", "2026-10-26"], {
      cwd: join(__dirname, ".."), env, encoding: "utf8", timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
}

test("detector CLI still reads unsharded ci-tests failures", () => {
  const report = collect({
    jobs: [{ id: 1, name: "ci-tests", conclusion: "failure" }],
    logs: { 1: testLog("original failure") },
  });
  assert.match(report, /Jobs in that set whose log names a failing test: 1\./);
  assert.match(report, /tests\/detector-probe\.test\.cjs › original failure/);
});

test("detector CLI reads both failed shards instead of the summary and isolates cached logs", () => {
  const report = collect({
    jobs: [
      { id: 1, name: "test-shard (0)", conclusion: "failure" },
      { id: 2, name: "test-shard (1)", conclusion: "failure" },
      { id: 3, name: "ci-tests", conclusion: "failure" },
    ],
    logs: { 1: testLog("first shard failure"), 2: testLog("second shard failure"), 3: summaryLog },
  });
  assert.match(report, /Jobs in that set whose log names a failing test: 1\./);
  assert.match(report, /tests\/detector-probe\.test\.cjs › first shard failure/);
  assert.match(report, /tests\/detector-probe\.test\.cjs › second shard failure/);
});

test("detector CLI keeps infrastructure separate without hiding another shard's test failure", () => {
  const report = collect({
    jobs: [
      { id: 1, name: "test-shard (0)", conclusion: "failure" },
      { id: 2, name: "test-shard (1)", conclusion: "failure" },
      { id: 3, name: "ci-tests", conclusion: "failure" },
    ],
    logs: { 1: infraLog, 2: testLog("real test failure"), 3: summaryLog },
  });
  assert.match(report, /Jobs in that set whose log names a failing test: 1\./);
  assert.match(report, /tests\/detector-probe\.test\.cjs › real test failure/);
  assert.match(report, /### rate-limit \(1\)/);
});

test("detector CLI reads failed shards for same-code comparisons across commits", () => {
  const report = collect({
    jobs: [
      { id: 1, name: "test-shard (0)", conclusion: "failure" },
      { id: 3, name: "ci-tests", conclusion: "failure" },
    ],
    logs: { 1: testLog("same-code failure"), 3: summaryLog }, differentSha: true,
  });
  assert.match(report, /## Same-code flakes across SHAs \(1\)/);
  assert.match(report, /tests\/detector-probe\.test\.cjs › same-code failure/);
  assert.match(report, /Jobs in that set whose log names a failing test: 0\./);
});

test("detector CLI reads a failed browser half as the browser lane (HYCI-32)", () => {
  const report = collect({
    jobs: [
      { id: 1, name: "browser-smoke-mobile", conclusion: "failure" },
      { id: 3, name: "browser-smoke", conclusion: "failure" },
    ],
    logs: { 1: testLog("[Mobile] › e2e/smoke/prod.spec.ts:120:5 › phone board shows the card"), 3: summaryLog },
    differentSha: true,
  });
  assert.match(report, /## Same-code flakes across SHAs \(1\)/);
  assert.match(report, /phone board shows the card/);
});

test("detector CLI preserves a pre-test infrastructure failure", () => {
  const report = collect({
    jobs: [
      { id: 1, name: "test-shard (0)", conclusion: "success" },
      { id: 3, name: "ci-tests", conclusion: "failure" },
    ],
    logs: { 3: infraLog },
  });
  assert.match(report, /Jobs in that set whose log names a failing test: 0\./);
  assert.match(report, /### rate-limit \(1\)/);
});
