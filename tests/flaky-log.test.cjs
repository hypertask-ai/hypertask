const { test } = require("node:test");
const assert = require("node:assert/strict");

const orderingLog = [
  "2026-10-24T17:39:44.3295903Z test at tests/htpr-7146-agent-scope-routes.test.cjs:398:1",
  "2026-10-24T17:39:44.3296725Z ✖ MCP timer running/report and team presence forward the authenticated agent to real services (348.756141ms)",
  "2026-10-24T17:39:44.3302654Z     actual: [ 4060, 15 ],",
  "2026-10-24T17:39:44.3302909Z     expected: [ 15, 4060 ],",
  "2026-10-24T17:39:44.3316903Z ##[error]Process completed with exit code 1.",
].join("\n");

const rateLimitLog = [
  "ci-tests\tSkip the build when the review is already red\t2026-10-24T16:32:53.0986219Z gh: API rate limit exceeded for installation. (HTTP 403)",
  "ci-tests\tSkip the build when the review is already red\t2026-10-24T16:32:53.1014122Z ##[error]Process completed with exit code 1.",
  "ci-tests\tRecord push test outcome\t2026-10-24T16:32:49.6975313Z   failures=$(sed -nE 's/^[[:space:]]*not ok [0-9]+ - (.*)$/\\1/p;",
].join("\n");

const browserLog = [
  "2026-10-24T16:53:15.4713687Z   1) [Desktop] › e2e/smoke/prod.spec.ts:216:5 › docked AI chat follows the viewed board and keeps hand picks board-local @id:chat-follows-board",
  "2026-10-24T16:53:15.4715977Z     Locator: getByTestId('ai-sidebar').locator('[data-ai-chat-scope]:visible > button').first()",
  "2026-10-24T16:53:15.4718181Z     Error: element(s) not found",
  "2026-10-24T16:53:15.4757539Z   1 failed",
  "2026-10-24T16:53:15.4758741Z     [Desktop] › e2e/smoke/prod.spec.ts:216:5 › docked AI chat follows the viewed board and keeps hand picks board-local @id:chat-follows-board",
  "2026-10-24T16:53:15.4759650Z   1 flaky",
  "2026-10-24T16:53:15.4760502Z     [Desktop] › e2e/smoke/layout-lock.spec.ts:111:7 › layout baseline: ticket from board card",
].join("\n");

test("ordering log is a test failure, not infra", async () => {
  const { classifyActionsLog } = await import("../scripts/flaky-log.mjs");
  const classified = classifyActionsLog(orderingLog);
  assert.equal(classified.kind, "test");
  assert.deepEqual(classified.tests, [
    "tests/htpr-7146-agent-scope-routes.test.cjs › MCP timer running/report and team presence forward the authenticated agent to real services",
  ]);
  assert.match(classified.evidenceLine, /actual: \[ 4060, 15 \], expected: \[ 15, 4060 \]/);
});

test("rate-limit log is infra and the sed echo is not a test name", async () => {
  const { classifyActionsLog } = await import("../scripts/flaky-log.mjs");
  const classified = classifyActionsLog(rateLimitLog);
  assert.equal(classified.kind, "infra");
  assert.equal(classified.infraId, "rate-limit");
  assert.match(classified.evidenceLine, /API rate limit exceeded/);
  assert.deepEqual(classified.tests, []);
});

test("browser-smoke keeps the failed chat locator and drops the retried layout test", async () => {
  const { classifyActionsLog } = await import("../scripts/flaky-log.mjs");
  const classified = classifyActionsLog(browserLog);
  assert.equal(classified.kind, "test");
  assert.deepEqual(classified.tests, [
    "e2e/smoke/prod.spec.ts › docked AI chat follows the viewed board and keeps hand picks board-local @id:chat-follows-board",
  ]);
  assert.match(classified.evidenceLine, /element\(s\) not found/);
});

test("same app code ignores lint scripts and rejects src or the failing test", async () => {
  const { sameAppCode } = await import("../scripts/flaky-log.mjs");
  const timer = ["tests/htpr-7146-agent-scope-routes.test.cjs › MCP timer running/report and team presence forward the authenticated agent to real services"];
  assert.equal(sameAppCode(["scripts/check-false-negatives.mjs"], timer), true);
  assert.equal(sameAppCode(["src/lib/timeTracking.ts"], timer), false);
  assert.equal(sameAppCode(["tests/htpr-7146-agent-scope-routes.test.cjs"], timer), false);
  assert.equal(sameAppCode(["e2e/smoke/prod.spec.ts"], ["e2e/smoke/prod.spec.ts › docked AI chat"]), false);
});

test("a Google font fetch failure is infra and the workflow grep echo is not", async () => {
  const { classifyActionsLog } = await import("../scripts/flaky-log.mjs");
  const fontLog = [
    "2026-10-24T14:45:15.7307872Z src/app/login/LoginComponent.tsx",
    "2026-10-24T14:45:15.7308168Z An error occurred in `next/font`.",
    "2026-10-24T14:45:15.7311056Z     at async nextFontGoogleFontLoader (/home/runner/work/hypertask/hypertask/node_modules/next/dist/compiled/@next/font/dist/google/loader.js:104:33)",
    "2026-10-24T14:45:16.3707847Z ##[error]Process completed with exit code 1.",
    "2026-10-24T14:45:16.4707847Z ✖ MCP timer running/report and team presence forward the authenticated agent to real services (12.5ms)",
  ].join("\n");
  const classified = classifyActionsLog(fontLog);
  assert.equal(classified.kind, "infra");
  assert.equal(classified.infraId, "font-fetch");
  assert.deepEqual(classified.tests, []);
  const echo = classifyActionsLog("2026-10-24T14:43:17.0375299Z grep -q 'next/font/google' \"$RUNNER_TEMP/next-build.log\" || exit 1");
  assert.notEqual(echo.infraId, "font-fetch");
});

test("the report excludes rate-limit and font-fetch from the flaky-test count", async () => {
  const { renderReport } = await import("../scripts/flaky-log.mjs");
  const report = renderReport({
    since: "2026-10-10",
    until: "2026-10-24",
    runsScanned: 3,
    retriedRuns: 2,
    failThenPass: 2,
    flakyTestJobs: 0,
    testIncidents: [],
    nonTest: [],
    sameCode: [],
  });
  assert.match(report, /Jobs in that set whose log names a failing test: 0\./);
  assert.match(report, /project-4060\/678/);
  assert.match(report, /project-4060\/668/);
  assert.match(report, /LoginComponent\.tsx/);
  assert.match(report, /not test flakes/);
});

test("ranking is deterministic", async () => {
  const { rankFlakes } = await import("../scripts/flaky-log.mjs");
  const incidents = [
    { test: "b", sha: "bbb", runId: 2, attempt: 1, failUrl: "f2", passUrl: "p2", evidenceLine: "not ok" },
    { test: "a", sha: "aaa", runId: 1, attempt: 1, failUrl: "f1", passUrl: "p1", evidenceLine: "not ok" },
    { test: "a", sha: "ccc", runId: 3, attempt: 1, failUrl: "f3", passUrl: "p3", evidenceLine: "not ok" },
  ];
  const forward = rankFlakes(incidents);
  const backward = rankFlakes(incidents.slice().reverse());
  assert.deepEqual(forward, backward);
  assert.equal(forward[0].test, "a");
  assert.equal(forward[0].shaCount, 2);
  assert.deepEqual(forward[0].shas, ["aaa", "ccc"]);
});
