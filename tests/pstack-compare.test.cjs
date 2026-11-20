const assert = require("node:assert/strict");
const test = require("node:test");
const {
  baseMoved,
  buildMarker,
  classifyRun,
  decideHeadOnly,
  parseMarker,
  reusableVerdict,
  sha256,
  summaryMarkers,
} = require("../scripts/lib/pstack-compare.cjs");

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const BASE = "c".repeat(40);
const TREE = "d".repeat(40);
const REPO = "hypertask-ai/hypertask";
const BOTS = ["github-actions[bot]", "hypertask-runners[bot]"];

const okRun = (overrides = {}) => ({
  preview: null,
  steps: [{ action: { op: "goto", path: "/" }, ok: true }],
  expects: [{ expect: { text: "Inbox" }, ok: true }],
  navigations: [{ url: "http://127.0.0.1:3000/inbox", status: 200 }],
  offOrigin: [],
  judged: "PASS",
  ...overrides,
});

const okHead = (overrides = {}) => ({ journey: "area:inbox", head: okRun(), ...overrides });

test("a preview that never started could not be evaluated", () => {
  assert.deepEqual(classifyRun({ preview: "down", steps: [], expects: [], navigations: [], offOrigin: [] }), { state: "unavailable", failIndex: -1 });
  assert.deepEqual(classifyRun(null), { state: "unavailable", failIndex: -1 });
  assert.equal(decideHeadOnly({ journeys: [okHead({ head: { preview: "down" } })] }).verdict, "UNEVALUATED");
});

test("a broken journey fails even when another journey never ran", () => {
  const result = decideHeadOnly({ journeys: [okHead({ journey: "area:inbox", head: null }), okHead({ journey: "area:boards", head: okRun({ steps: [{ ok: true }, { ok: false }] }) })] });
  assert.equal(result.verdict, "FAIL");
  assert.match(result.notes, /area:boards: failed at step 2/);
});

test("a failing step, a failing expect and a bad document status each fail a run", () => {
  assert.deepEqual(classifyRun(okRun({ steps: [{ ok: true }, { ok: false }] })), { state: "failed", failIndex: 1 });
  assert.deepEqual(classifyRun(okRun({ steps: [{ ok: true }], expects: [{ ok: true }, { ok: false }] })), { state: "failed", failIndex: 2 });
  assert.equal(classifyRun(okRun({ navigations: [{ url: "http://127.0.0.1:3000/x", status: 500 }] })).state, "failed");
  assert.equal(classifyRun(okRun({ offOrigin: [{ url: "https://example.com", kind: "navigation" }] })).state, "failed");
});

test("a journey with no document response fails unless every action is an api call", () => {
  assert.equal(classifyRun(okRun({ navigations: [] })).state, "failed");
  assert.equal(classifyRun(okRun({ navigations: [], apiOnly: true })).state, "ok");
  assert.equal(classifyRun(okRun({ navigations: [] }), { actions: [{ op: "api", method: "GET", path: "/api/health" }] }).state, "ok");
  assert.equal(classifyRun(okRun({ navigations: [] }), { actions: [{ op: "goto", path: "/" }] }).state, "failed");
});

test("an unrecognized judge verdict fails closed", () => {
  assert.equal(classifyRun(okRun({ judged: "PENDING" })).state, "failed");
  assert.equal(classifyRun(okRun({ judged: "maybe" })).state, "failed");
  assert.equal(classifyRun(okRun({ judged: "" })).state, "ok");
  assert.equal(classifyRun(okRun({ judged: "PASS+NOTES" })).state, "ok");
});

test("a run carries its judged verdict as an object, and a judge-only failure says so", () => {
  assert.equal(classifyRun(okRun({ judged: { verdict: "PASS" } })).state, "ok");
  assert.equal(classifyRun(okRun({ judged: { verdict: "FAIL" } })).state, "failed");
  const judged = decideHeadOnly({ journeys: [okHead({ head: okRun({ judged: "FAIL" }) })] });
  assert.equal(judged.verdict, "FAIL");
  assert.match(judged.notes, /area:inbox: the judge failed it/);
});

test("a journey the judge never read is unevaluated, and a broken step still fails", () => {
  const unjudged = decideHeadOnly({ journeys: [okHead({ head: okRun({ judged: "UNEVALUATED" }) })] });
  assert.equal(unjudged.verdict, "UNEVALUATED");
  assert.match(unjudged.notes, /the judge model did not answer/);
  const broken = decideHeadOnly({ journeys: [okHead({ head: okRun({ judged: "UNEVALUATED", steps: [{ ok: false }] }) })] });
  assert.equal(broken.verdict, "FAIL");
});

test("every journey passing on head is a bare pass", () => {
  const result = decideHeadOnly({ journeys: [okHead({ journey: "area:inbox" }), okHead({ journey: "change:primary" })] });
  assert.deepEqual(result, { verdict: "PASS", notes: "" });
});

test("an empty journey list is not a pass", () => {
  assert.equal(decideHeadOnly({ journeys: [] }).verdict, "FAIL");
});

test("a head journey that is red in the nightly pass does not block the pull request", () => {
  const captured = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "fixtures", "pstack-verifier", "44445936703-evidence.json"), "utf8"));
  const journeys = captured.journeys.map((run) => ({ journey: run.journey, head: { ...run, judged: "PASS" } }));
  const red = journeys.map((item) => item.journey.slice("area:".length));
  const excused = decideHeadOnly({ journeys, redFeatures: red });
  assert.equal(excused.verdict, "PASS+NOTES");
  assert.match(excused.notes, /already red on production/);
  assert.doesNotMatch(excused.notes, /failed at step/);
});

test("a head journey that fails while the nightly pass is green for that feature still fails", () => {
  const result = decideHeadOnly({ journeys: [okHead({ journey: "area:inbox", head: okRun({ steps: [{ ok: true }, { ok: false }] }) })], redFeatures: ["boards-and-views"] });
  assert.equal(result.verdict, "FAIL");
  assert.match(result.notes, /area:inbox: failed at step 2/);
  assert.doesNotMatch(result.notes, /already red on production/);
});

test("the nightly red list never excuses the change journey or a feature it does not drive", () => {
  const change = decideHeadOnly({ journeys: [okHead({ journey: "change:primary", head: okRun({ steps: [{ ok: false }] }) })], redFeatures: ["primary", "inbox"] });
  assert.equal(change.verdict, "FAIL");
  const undriven = decideHeadOnly({ journeys: [okHead({ journey: "area:mcp-task-lookup", head: okRun({ steps: [{ ok: false }] }) })], redFeatures: [] });
  assert.equal(undriven.verdict, "FAIL");
});

test("a bug fix needs its repro to pass on head", () => {
  const repro = (ok) => [{ journey: "change:repro", head: okRun({ steps: [{ ok }] }) }];
  assert.equal(decideHeadOnly({ journeys: repro(true), bugfix: true }).verdict, "PASS");
  const stillFails = decideHeadOnly({ journeys: repro(false), bugfix: true });
  assert.equal(stillFails.verdict, "FAIL");
  assert.match(stillFails.notes, /change:repro: failed at step 1/);
});

test("a bug fix with no repro journey fails", () => {
  const result = decideHeadOnly({ journeys: [okHead({ journey: "area:inbox" })], bugfix: true });
  assert.equal(result.verdict, "FAIL");
  assert.match(result.notes, /no repro journey/);
});

test("the marker round-trips and refuses a field that is not a sha", () => {
  const marker = buildMarker({ run: 4242, attempt: 2, head: SHA, tree: TREE, base: BASE });
  assert.match(marker, /^<!-- pstack-verifier run 4242 attempt 2 head a{40} tree d{40} base c{40} -->$/);
  assert.deepEqual(parseMarker(`text\n${marker}\nmore`), { run: "4242", attempt: "2", head: SHA, tree: TREE, base: BASE });
  assert.equal(parseMarker("no marker here"), null);
  assert.throws(() => buildMarker({ run: 1, attempt: 1, head: "main", tree: TREE, base: BASE }), /head is not a sha/);
  assert.throws(() => buildMarker({ run: "x", attempt: 1, head: SHA, tree: TREE, base: BASE }), /not a run id/);
});

const artifact = () => ({ run: "4242", attempt: "1", head: SHA, tree: TREE, baseSha: BASE, patchId: "e".repeat(40), diffSha256: sha256("diff"), verdict: "PASS" });
const status = (overrides = {}) => ({ state: "success", target_url: `https://github.com/${REPO}/actions/runs/4242/attempts/1`, ...overrides });
const comment = (overrides = {}) => ({ user: { login: "hypertask-runners[bot]" }, body: buildMarker({ run: 4242, attempt: 1, head: SHA, tree: TREE, base: BASE }), ...overrides });
const current = () => ({ baseSha: BASE, tree: TREE, patchId: "e".repeat(40), diffSha256: sha256("diff") });

test("a pass is reused only for the same base, head tree, patch and diff", () => {
  const result = reusableVerdict({ comments: [comment()], artifact: artifact(), status: status(), current: current(), logins: BOTS, repo: REPO });
  assert.equal(result.reuse, true);
  assert.equal(result.verdict, "PASS");
  assert.match(result.notes, /reused/);
});

test("a rebase that brings new production files in gives a different head tree, so no reuse", () => {
  const result = reusableVerdict({ comments: [comment()], artifact: artifact(), status: status(), current: { ...current(), tree: OTHER }, logins: BOTS, repo: REPO });
  assert.equal(result.reuse, false);
  assert.match(result.reason, /head tree differs/);
});

test("a new base never reuses a pass", () => {
  const result = reusableVerdict({ comments: [comment()], artifact: artifact(), status: status(), current: { ...current(), baseSha: OTHER }, logins: BOTS, repo: REPO });
  assert.equal(result.reuse, false);
});

test("a whitespace-only edit changes the diff hash, so no reuse", () => {
  const result = reusableVerdict({ comments: [comment()], artifact: artifact(), status: status(), current: { ...current(), diffSha256: sha256("diff with a space") }, logins: BOTS, repo: REPO });
  assert.equal(result.reuse, false);
  assert.match(result.reason, /diff differs/);
});

test("a marker from a login this verifier does not post as is ignored", () => {
  const result = reusableVerdict({ comments: [comment({ user: { login: "someone" } })], artifact: artifact(), status: status(), current: current(), logins: BOTS, repo: REPO });
  assert.equal(result.reuse, false);
  assert.match(result.reason, /no matching marker/);
});

test("a genuine success status from another run cannot be borrowed", () => {
  const result = reusableVerdict({ comments: [comment()], artifact: artifact(), status: status({ target_url: `https://github.com/${REPO}/actions/runs/9999/attempts/1` }), current: current(), logins: BOTS, repo: REPO });
  assert.equal(result.reuse, false);
  assert.match(result.reason, /another run/);
});

test("a failed or foreign status never reuses a pass", () => {
  assert.equal(reusableVerdict({ comments: [comment()], artifact: artifact(), status: status({ state: "failure" }), current: current(), logins: BOTS, repo: REPO }).reuse, false);
  assert.equal(reusableVerdict({ comments: [comment()], artifact: artifact(), status: status({ target_url: "https://example.com/actions/runs/4242/attempts/1" }), current: current(), logins: BOTS, repo: REPO }).reuse, false);
});

test("an earlier verdict that is not a pass is not reused", () => {
  const result = reusableVerdict({ comments: [comment()], artifact: { ...artifact(), verdict: "FAIL" }, status: status(), current: current(), logins: BOTS, repo: REPO });
  assert.equal(result.reuse, false);
  assert.match(result.reason, /not a pass/);
});

test("a missing verdict artifact means no reuse", () => {
  assert.equal(reusableVerdict({ comments: [comment()], artifact: null, status: status(), current: current(), logins: BOTS, repo: REPO }).reuse, false);
});

test("publishing sees a head or base that moved during the run", () => {
  const plan = { sha: SHA, baseSha: BASE };
  assert.deepEqual(baseMoved({ item: { head: { sha: SHA }, base: { sha: BASE } }, plan }), { moved: false });
  assert.deepEqual(baseMoved({ item: { head: { sha: OTHER }, base: { sha: BASE } }, plan }), { moved: true, part: "head" });
  assert.deepEqual(baseMoved({ item: { head: { sha: SHA }, base: { sha: OTHER } }, plan }), { moved: true, part: "base" });
});

test("only this verifier's own markers are read for base drift", () => {
  const mine = comment();
  const theirs = comment({ user: { login: "someone" }, body: buildMarker({ run: 7, attempt: 1, head: OTHER, tree: TREE, base: OTHER }) });
  assert.deepEqual(summaryMarkers({ comments: [mine, theirs], logins: BOTS }).map((marker) => marker.run), ["4242"]);
});

test("a bug fix with no repro and a stated reason could not be evaluated", () => {
  const result = decideHeadOnly({
    journeys: [{ journey: "area:inbox", head: okRun() }],
    bugfix: true,
    bugfixUnevaluated: "the archived board cannot be reached by any write route",
  });
  assert.equal(result.verdict, "UNEVALUATED");
  assert.match(result.notes, /no repro journey: the archived board cannot be reached/);
});
