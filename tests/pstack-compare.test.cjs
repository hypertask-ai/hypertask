const assert = require("node:assert/strict");
const test = require("node:test");
const {
  baseMoved,
  buildMarker,
  classifyRun,
  decideComparison,
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

test("a preview that never started is unavailable, never a failed repro", () => {
  assert.deepEqual(classifyRun({ preview: "down", steps: [], expects: [], navigations: [], offOrigin: [] }), { state: "unavailable", failIndex: -1 });
  assert.deepEqual(classifyRun(null), { state: "unavailable", failIndex: -1 });
  assert.equal(decideComparison({ journeys: [{ journey: "change:repro", base: { preview: "down" }, head: okRun() }], bugfix: true }).verdict, "FAIL");
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

test("a cached api-only base run keeps its plan, so a bugfix repro cannot claim it reproduced", () => {
  const cached = { steps: [{ action: { op: "api", method: "POST", path: "/api/mcp/tasks" }, ok: true }], expects: [], navigations: [], offOrigin: [], judged: { verdict: "PASS" } };
  const head = { ...cached, apiOnly: true, judged: "PASS" };
  assert.equal(classifyRun(cached).state, "ok");
  assert.equal(classifyRun(head).state, "ok");
  const repro = decideComparison({ journeys: [{ journey: "change:repro", base: cached, head }], bugfix: true });
  assert.equal(repro.verdict, "FAIL");
  assert.match(repro.notes, /does not reproduce the bug/);
  assert.equal(decideComparison({ journeys: [{ journey: "area:api", base: cached, head }] }).verdict, "PASS");
});

test("an unrecognized judge verdict fails closed", () => {
  assert.equal(classifyRun(okRun({ judged: "PENDING" })).state, "failed");
  assert.equal(classifyRun(okRun({ judged: "maybe" })).state, "failed");
  assert.equal(classifyRun(okRun({ judged: "" })).state, "ok");
  assert.equal(classifyRun(okRun({ judged: "PASS+NOTES" })).state, "ok");
});

test("a head that regressed against a passing base fails", () => {
  const result = decideComparison({ journeys: [{ journey: "area:inbox", base: okRun(), head: okRun({ steps: [{ ok: true }, { ok: false }] }) }] });
  assert.equal(result.verdict, "FAIL");
  assert.match(result.notes, /area:inbox: regression at step 2/);
});

test("a journey that broke earlier than base did fails even when both failed", () => {
  const base = okRun({ steps: [{ ok: true }, { ok: true }, { ok: false }] });
  const head = okRun({ steps: [{ ok: false }, { ok: true }, { ok: false }] });
  const result = decideComparison({ journeys: [{ journey: "area:inbox", base, head }] });
  assert.equal(result.verdict, "FAIL");
  assert.match(result.notes, /regression at step 1, base reached step 4/);
});

test("a journey that got further than base and still fails is a note, not a fail", () => {
  const base = okRun({ steps: [{ ok: false }, { ok: true }] });
  const head = okRun({ steps: [{ ok: true }, { ok: false }] });
  const result = decideComparison({ journeys: [{ journey: "area:inbox", base, head }] });
  assert.equal(result.verdict, "PASS+NOTES");
  assert.match(result.notes, /got further than base/);
});

test("a missing base comparison fails, and never claims a pass", () => {
  const result = decideComparison({ journeys: [{ journey: "area:inbox", base: null, head: okRun() }] });
  assert.equal(result.verdict, "FAIL");
  assert.match(result.notes, /the base comparison did not run/);
});

test("a journey that works now and did not on base passes with a note", () => {
  const base = okRun({ steps: [{ ok: true }, { ok: false }] });
  const result = decideComparison({ journeys: [{ journey: "change:primary", base, head: okRun() }] });
  assert.equal(result.verdict, "PASS+NOTES");
  assert.match(result.notes, /works now/);
});

test("every journey passing on head is a bare pass", () => {
  const result = decideComparison({ journeys: [{ journey: "area:inbox", base: okRun(), head: okRun() }, { journey: "change:primary", base: okRun(), head: okRun() }] });
  assert.deepEqual(result, { verdict: "PASS", notes: "" });
});

test("an empty journey list is not a pass", () => {
  assert.equal(decideComparison({ journeys: [] }).verdict, "FAIL");
});

test("a bug fix needs its repro to fail on base and pass on head", () => {
  const failsOnBase = okRun({ steps: [{ ok: false }] });
  assert.equal(decideComparison({ journeys: [{ journey: "change:repro", base: failsOnBase, head: okRun() }], bugfix: true }).verdict, "PASS");
  const reproPassesOnBase = decideComparison({ journeys: [{ journey: "change:repro", base: okRun(), head: okRun() }], bugfix: true });
  assert.equal(reproPassesOnBase.verdict, "FAIL");
  assert.match(reproPassesOnBase.notes, /does not reproduce the bug/);
  const stillFails = decideComparison({ journeys: [{ journey: "change:repro", base: failsOnBase, head: failsOnBase }], bugfix: true });
  assert.equal(stillFails.verdict, "FAIL");
});

test("a cached base result carries its judged verdict as an object", () => {
  assert.equal(classifyRun(okRun({ judged: { verdict: "PASS" } })).state, "ok");
  assert.equal(classifyRun(okRun({ judged: { verdict: "FAIL" } })).state, "failed");
});

test("a bug fix whose journeys are not named as a repro fails even when base failed and head passed", () => {
  const failsOnBase = okRun({ steps: [{ ok: false }] });
  const result = decideComparison({ journeys: [{ journey: "change:primary", base: failsOnBase, head: okRun() }], bugfix: true });
  assert.equal(result.verdict, "FAIL");
  assert.match(result.notes, /no repro journey/);
});

test("a bug fix with no repro journey fails", () => {
  const result = decideComparison({ journeys: [{ journey: "area:inbox", base: okRun(), head: okRun() }], bugfix: true });
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
