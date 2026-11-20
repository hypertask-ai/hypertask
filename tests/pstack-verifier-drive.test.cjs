const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, rmSync } = require("node:fs");
const { createServer } = require("node:http");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");

const browserSkip = !existsSync(chromium.executablePath()) && "Playwright browser not installed";
const load = () => import("../scripts/pstack-verifier-eval.mjs");
const loadVerifier = () => import("../scripts/pstack-verifier.mjs");

test("the drive reaches every planned journey at desktop width and at phone width", { skip: browserSkip }, async () => {
  const { DRIVEN_CASE, FIELD_ON_EVERY_SIZE_HTML, driveEvalEvidence } = await load();
  const evidence = await driveEvalEvidence({ item: DRIVEN_CASE, html: FIELD_ON_EVERY_SIZE_HTML });
  assert.deepEqual(evidence.journeys.map((run) => run.viewport), ["desktop", "phone"]);
  for (const run of evidence.journeys) {
    assert.equal(run.journey, "change:primary");
    assert.ok(run.steps.every((step) => step.ok), `${run.viewport} step failed: ${JSON.stringify(run.steps)}`);
    assert.ok(run.expects.every((expect) => expect.ok), `${run.viewport} expect failed`);
  }
});

test("the planted phone only bug fails through the real drive, not through the model", { skip: browserSkip }, async () => {
  const { judgeDrivenCase } = await load();
  const result = await judgeDrivenCase({ ask: async () => ({ verdict: "PASS", notes: "The saved field is visible." }) });
  assert.equal(result.verdict, "FAIL");
  assert.equal(result.ok, true);
  assert.match(result.notes, /change:primary \[phone\]: failed at step \d+/);
  assert.doesNotMatch(result.notes, /change:primary \[desktop\]:/);
  const desktop = result.evidence.journeys.find((run) => run.viewport === "desktop");
  const phone = result.evidence.journeys.find((run) => run.viewport === "phone");
  assert.ok(desktop.expects.every((expect) => expect.ok));
  assert.ok(phone.expects.some((expect) => !expect.ok));
});

test("the phone lane starts while the desktop lane is still loading", { skip: browserSkip }, async () => {
  const [evalModule, { drivePlan }] = await Promise.all([load(), loadVerifier()]);
  const seen = { waiting: 0, peak: 0, overlapped: false };
  let release = () => {};
  const gate = new Promise((done) => { release = done; });
  const server = createServer(async (request, response) => {
    if (request.url !== "/") {
      response.writeHead(404);
      response.end();
      return;
    }
    seen.waiting += 1;
    seen.peak = Math.max(seen.peak, seen.waiting);
    if (seen.waiting >= 2) {
      seen.overlapped = true;
      release();
    }
    await gate;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(evalModule.FIELD_ON_EVERY_SIZE_HTML);
    seen.waiting -= 1;
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const safety = setTimeout(release, 5000);
  const work = mkdtempSync(path.join(tmpdir(), "pstack-lanes-"));
  const browser = await chromium.launch({ headless: true });
  try {
    const plan = evalModule.drivenPlan();
    const run = await drivePlan({ browser, projectId: "1", plan, base: `http://127.0.0.1:${server.address().port}`, shotsRoot: path.join(work, "shots") });
    assert.equal(seen.overlapped, true, "the phone lane did not ask for the page while the desktop lane was loading");
    assert.equal(seen.peak, 2);
    assert.deepEqual(run.journeys.map((item) => item.viewport), ["desktop", "phone"]);
    assert.ok(run.journeys.every((item) => item.expects.every((expect) => expect.ok)));
  } finally {
    clearTimeout(safety);
    await browser.close();
    await new Promise((done) => server.close(done));
    rmSync(work, { recursive: true, force: true });
  }
});
