const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

test("a quarantined leaf does not fail the check and any other leaf does", async () => {
  const { parseTapFailures, checkOutcome } = await import("../scripts/test-quarantine.mjs");
  const dir = mkdtempSync(path.join(tmpdir(), "quarantine-"));
  const file = path.join(dir, "order.test.cjs");
  writeFileSync(file, `
    const { test } = require("node:test");
    const assert = require("node:assert/strict");
    test("keeps going", () => assert.equal(1, 1));
    test("MCP timer running/report and team presence forward the authenticated agent to real services", () => {
      assert.deepEqual([4060, 15], [15, 4060]);
    });
    test("unrelated gate", () => assert.fail("gate"));
  `);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST") || key === "NODE_CHANNEL_FD") delete env[key];
  }
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", file], { encoding: "utf8", env });
  const output = `${result.stdout}${result.stderr}`;
  const failures = parseTapFailures(output);
  const names = failures.map((failure) => failure.name);
  assert.ok(names.includes("MCP timer running/report and team presence forward the authenticated agent to real services"));
  assert.ok(names.includes("unrelated gate"));
  const quarantine = [{ test: "MCP timer running/report and team presence forward the authenticated agent to real services" }];
  assert.equal(checkOutcome(result.status, failures, quarantine).failCheck, true);
  assert.equal(checkOutcome(result.status, failures, [
    ...quarantine,
    { test: "unrelated gate" },
  ]).failCheck, false);
});

test("missing owner or ticket fails the quarantine lint", async () => {
  const { entryProblems, evidenceUrlProblem } = await import("../scripts/test-quarantine.mjs");
  const problems = entryProblems({
    test: "tests/example.test.cjs",
    ticket: "https://app.hypertask.ai/detail/project-4060/668",
    evidence: [
      "https://github.com/hypertask-ai/hypertask/actions/runs/1",
      "https://github.com/hypertask-ai/hypertask/actions/runs/2",
    ],
    reason: "ordering depends on the clock",
    addedAt: "2026-10-24",
  });
  assert.ok(problems.includes("missing owner"));
  assert.equal(evidenceUrlProblem("https://evil.example/github.com/actions/runs/1"), "evidence link host must be github.com");
  assert.equal(evidenceUrlProblem("https://github.com/hypertask-ai/hypertask/actions/runs/40114868851"), null);
});
