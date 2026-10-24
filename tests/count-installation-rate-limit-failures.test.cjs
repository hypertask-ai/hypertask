const assert = require("node:assert/strict");
const { test } = require("node:test");
const counter = import("../scripts/count-installation-rate-limit-failures.mjs");

const appSmokeLog = [
  "2026-10-24T18:23:51.4601088Z \u001b[36;1mgh api --method POST \"repos/$REPO/statuses/$head_sha\" \\",
  "2026-10-24T18:23:54.1129683Z gh: API rate limit exceeded for installation. If you reach out to GitHub Support for help, please include the request ID D829:1A3BA9:204915:689A84:6ADCF7B9 and timestamp 2026-10-24 18:23:54 UTC. (HTTP 403)",
  "2026-10-24T18:23:54.1155935Z ##[error]Process completed with exit code 1.",
].join("\n");

const waitCapLog = [
  "2026-10-24T18:22:10.0000000Z ##[error]GitHub rate limit wait cap exceeded (300s total; 0s already waited, 1087s requested); settings were not verified.",
].join("\n");

test("installation message is counted and the echoed script line is not", async () => {
  const { classifyLog, attributeStep } = await counter;
  const hits = classifyLog(appSmokeLog);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "installation");
  assert.equal(hits[0].match, "api-message");
  assert.match(hits[0].line, /^gh: API rate limit exceeded for installation/);
  const step = attributeStep([
    { name: "Set up job", conclusion: "success" },
    { name: "Validate the exact pull-request revision", conclusion: "failure" },
  ], hits);
  assert.equal(step.step, "Validate the exact pull-request revision");
  assert.equal(step.stepAttribution, "only-failed-step");
});

test("wait cap beyond 120s is the hourly installation reset", async () => {
  const { classifyLog } = await counter;
  const [hit] = classifyLog(waitCapLog);
  assert.equal(hit.kind, "installation");
  assert.equal(hit.match, "wait-cap");
  assert.equal(hit.requestedSeconds, 1087);
  assert.equal(hit.resetAt, "2026-10-24T18:40:17.000Z");
});

test("a short secondary limit stays out of the installation count", async () => {
  const { classifyLog, summarize } = await counter;
  const hits = classifyLog("2026-10-24T18:00:00.0000000Z You have exceeded a secondary rate limit. Please wait a few minutes.");
  assert.equal(hits[0].kind, "secondary");
  const summary = summarize([
    { kind: "secondary", runId: 1, createdAt: "2026-10-24T18:00:00Z", workflow: "CI Tests", step: "Verify live required-check settings" },
    { kind: "installation", runId: 2, createdAt: "2026-10-24T18:23:54Z", workflow: "App Smoke", step: "Validate the exact pull-request revision" },
    { kind: "installation", runId: 2, createdAt: "2026-10-24T18:23:54Z", workflow: "App Smoke", step: "Validate the exact pull-request revision" },
  ], { start: new Date("2026-10-10T19:00:00Z"), end: new Date("2026-10-24T19:00:00Z"), scannedRuns: 3, unscannedJobs: 0 });
  assert.equal(summary.installationRuns, 1);
  assert.equal(summary.otherKinds.secondary, 1);
  assert.equal(summary.byDay.length, 15);
  assert.equal(summary.byDay.find(([day]) => day === "2026-10-11")[1], 0);
  assert.equal(summary.byDay.find(([day]) => day === "2026-10-24")[1], 1);
  assert.equal(summary.stepTotals[0][0], "App Smoke / Validate the exact pull-request revision");
  assert.equal(summary.stepTotals[0][1], 1);
});

test("the window is split on UTC midnights without a gap or overlap", async () => {
  const { windowSlices } = await counter;
  const slices = windowSlices(new Date("2026-10-23T22:00:00Z"), new Date("2026-10-24T02:00:00Z"));
  assert.deepEqual(slices.map((slice) => [slice.day, slice.from.toISOString(), slice.to.toISOString()]), [
    ["2026-10-23", "2026-10-23T22:00:00.000Z", "2026-10-24T00:00:00.000Z"],
    ["2026-10-24", "2026-10-24T00:00:00.000Z", "2026-10-24T02:00:00.000Z"],
  ]);
});
