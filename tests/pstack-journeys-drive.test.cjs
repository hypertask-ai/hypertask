const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const { sha256 } = require("../scripts/lib/pstack-compare.cjs");
const { scriptHash } = require("../scripts/lib/pstack-journeys.cjs");

const load = () => import("../scripts/pstack-verifier.mjs");
const binding = { sha: "a".repeat(40), run: "9", attempt: "1" };
const BASE = "b".repeat(40);
const MAP = "c".repeat(40);
const request = (files, extra = {}) => ({ ...binding, baseSha: BASE, title: "HYP-1 [BUGFIX] Fix the inbox", body: "Author-Model: deepseek", diff: "", files, filesTruncated: false, boardPath: "/project?id={id}", taskPath: "/detail/project-{id}/1", ...extra });
const page = (name, text) => ({ name, text });
const INBOX_PAGE = "# Inbox\nInbox rows from `src/pages/api/queues/inboxReminder.ts`.";
const pagePlan = (reason = "page") => ({ actions: [{ op: "goto", path: "/inbox" }], expect: [{ text: "Inbox" }], reason });
const changePlan = () => ({ actions: [{ op: "goto", path: "/all-tasks" }], expect: [{ text: "All tasks" }], reason: "" });
const cachedArea = (overrides = {}) => ({
  baseSha: BASE,
  mapSha: MAP,
  journey: "area:inbox",
  scriptHash: scriptHash(pagePlan().actions, pagePlan().expect),
  pageHash: sha256(INBOX_PAGE),
  ok: true,
  judged: { verdict: "PASS" },
  steps: [{ action: { op: "goto", path: "/inbox" }, ok: true }],
  expects: [{ expect: { text: "Inbox" }, ok: true }],
  navigations: [{ url: "http://127.0.0.1:3000/inbox", status: 200 }],
  offOrigin: [],
  ...overrides,
});

test("a mapped page gets its own journey from the page text, then the change journey", async () => {
  const prompts = [];
  const plan = await (await load()).planFromRequest(request(["src/pages/api/queues/inboxReminder.ts"]), {
    binding,
    mapSha: MAP,
    pages: [page("inbox", INBOX_PAGE)],
    entries: [],
    compare: true,
    ask(prompt) {
      prompts.push(prompt);
      return prompts.length === 1 ? pagePlan() : changePlan();
    },
  });
  assert.deepEqual(plan.journeys.map((item) => item.journey), ["change:repro", "area:inbox"]);
  assert.match(prompts[0], /DATA: FEATURE PAGE/);
  assert.doesNotMatch(prompts[0], /DATA: TITLE/);
  assert.match(prompts[1], /DATA: TITLE/);
  assert.deepEqual(plan.journeys[0].actions, changePlan().actions);
  assert.deepEqual(plan.actions, changePlan().actions);
});

const areaCases = [
  ["a cached area journey is adopted with no model call for that page", INBOX_PAGE, [cachedArea()], 1, [false, true]],
  ["a cached area journey for another base, map or page text is not adopted", `${INBOX_PAGE} changed`, [cachedArea(), cachedArea({ baseSha: "d".repeat(40) }), cachedArea({ mapSha: "e".repeat(40) })], 2, [true, null]],
];
for (const [name, text, entries, calls, want] of areaCases) test(name, async () => {
  const asked = [];
  const plan = await (await load()).planFromRequest(request(["src/pages/api/queues/inboxReminder.ts"]), {
    binding,
    mapSha: MAP,
    pages: [page("inbox", text)],
    entries,
    compare: true,
    ask(prompt) {
      asked.push(prompt);
      return asked.length === 1 && calls > 1 ? pagePlan() : changePlan();
    },
  });
  assert.equal(asked.length, calls);
  assert.ok(asked.some((prompt) => /DATA: TITLE/.test(prompt)));
  const area = plan.journeys.find((item) => item.journey === "area:inbox");
  assert.deepEqual([area.planned, area.base?.ok ?? null], want);
  assert.deepEqual(area.actions, pagePlan().actions);
});

test("a change that matches no page plans only the change journey", async () => {
  const plan = await (await load()).planFromRequest(request(["src/lib/api/task-writes/create-global.ts"]), {
    binding,
    mapSha: MAP,
    pages: [page("inbox", INBOX_PAGE)],
    entries: [],
    compare: true,
    ask: () => changePlan(),
  });
  assert.deepEqual(plan.journeys.map((item) => item.journey), ["change:repro"]);
});

test("area planning waits for the comparison, so a page failure cannot reach the legacy plan", async () => {
  const asked = [];
  const plan = await (await load()).planFromRequest(request(["src/pages/api/queues/inboxReminder.ts"]), { binding, mapSha: MAP, pages: [page("inbox", INBOX_PAGE)], entries: [], ask(prompt) { asked.push(prompt); return changePlan(); } });
  assert.deepEqual([asked.length, plan.fail, plan.journeys.map((item) => item.journey)], [1, "", ["change:repro"]]);
});

test("journeys stay inert unless the workflow asks for the comparison", async () => {
  const deps = { binding, mapSha: MAP, pages: [page("inbox", INBOX_PAGE)], entries: [], ask: () => changePlan() };
  delete process.env.PSTACK_VERIFIER_COMPARE;
  assert.equal((await (await load()).planFromRequest(request(["src/pages/api/queues/inboxReminder.ts"]), deps)).compare, undefined);
  process.env.PSTACK_VERIFIER_COMPARE = "true";
  try {
    assert.equal((await (await load()).planFromRequest(request(["src/pages/api/queues/inboxReminder.ts"]), deps)).compare, true);
  } finally {
    delete process.env.PSTACK_VERIFIER_COMPARE;
  }
});

test("non-app changes still skip the model and carry no journeys", async () => {
  const plan = await (await load()).planFromRequest(request(["docs/ci.md"], { title: "HYP-2 [INFRA] Docs" }), { binding, mapSha: MAP, pages: [], entries: [], ask() { throw new Error("model"); } });
  assert.equal(plan.reason, "no user path");
  assert.equal(plan.journeys, undefined);
});

test("the drive runs every planned journey and keeps one evidence entry per journey", async () => {
  const seen = [];
  const run = async ({ plan, shotsDir }) => {
    seen.push([plan.actions[0].path, shotsDir]);
    return { steps: [{ action: plan.actions[0], ok: true, error: "" }], expects: [{ expect: plan.expect[0], ok: true, error: "" }] };
  };
  const shotsRoot = mkdtempSync(join(tmpdir(), "journeys-"));
  const plan = { ...binding, actions: [{ op: "goto", path: "/inbox" }], expect: [], journeys: [{ journey: "area:inbox", actions: [{ op: "goto", path: "/inbox" }], expect: [] }, { journey: "change:repro", actions: [{ op: "goto", path: "/all-tasks" }], expect: [] }] };
  const result = await (await load()).runJourneys({ page: {}, plan, base: "http://127.0.0.1:3000", shotsRoot, run, nextNavigations: () => [] });
  assert.deepEqual(result.journeys.map((item) => item.journey), ["area:inbox", "change:repro"]);
  assert.deepEqual(seen.map((item) => item[0]), ["/inbox", "/all-tasks"]);
  assert.equal(seen[0][1], shotsRoot);
  assert.equal(seen[1][1], join(shotsRoot, "1"));
  assert.equal(result.journeys.length, 2);
  assert.deepEqual(result.steps, result.journeys[1].steps);
  assert.equal(result.journeys[0].apiOnly, false);
});

test("legacy evidence carries only the change journey's off-origin events", async () => {
  const offOrigin = [];
  const run = async ({ plan }) => { if (plan.actions[0].path === "/inbox") offOrigin.push({ url: "http://elsewhere.invalid/inbox" }); return { steps: [{ action: plan.actions[0], ok: true, error: "" }], expects: [] }; };
  const plan = { journeys: [{ journey: "area:inbox", actions: [{ op: "goto", path: "/inbox" }], expect: [] }, { journey: "change:repro", actions: [{ op: "goto", path: "/all-tasks" }], expect: [] }] };
  const result = await (await load()).runJourneys({ page: {}, plan, base: "http://127.0.0.1:3000", shotsRoot: mkdtempSync(join(tmpdir(), "journeys-off-")), offOrigin, run });
  assert.deepEqual([result.journeys[0].offOrigin.length, result.offOrigin], [1, []]);
});

test("a planned area journey drives the run, and a failed plan never does", async () => {
  const driveNeeded = (await load()).driveNeeded;
  const journeys = [{ journey: "area:inbox", actions: [{ op: "goto", path: "/inbox" }], expect: [] }];
  assert.deepEqual([true, false], [driveNeeded({ actions: [], journeys }), driveNeeded({ actions: [], journeys, fail: "model failed" })]);
});

test("a failed plan never reaches the comparison, even with area journeys", async () => {
  const comparisonMode = (await load()).comparisonMode;
  const plan = { compare: true, journeys: [{ journey: "area:inbox" }] };
  assert.deepEqual([true, false, false], [comparisonMode(plan), comparisonMode({ ...plan, fail: "the change plan failed" }), comparisonMode({ ...plan, compare: undefined })]);
});

test("an api-only journey is marked so a missing document response is not a failure", async () => {
  const run = async () => ({ steps: [{ action: { op: "api", method: "GET", path: "/api/x", body: {}, expectStatus: 200 }, ok: true, error: "" }], expects: [] });
  const plan = { journeys: [{ journey: "change:primary", actions: [{ op: "api", method: "GET", path: "/api/x", body: {}, expectStatus: 200 }], expect: [] }] };
  const result = await (await load()).runJourneys({ page: {}, plan, base: "http://127.0.0.1:3000", shotsRoot: mkdtempSync(join(tmpdir(), "journeys-api-")), run });
  assert.equal(result.journeys[0].apiOnly, true);
});

const headRun = (ok = true) => ({ journey: "change:repro", steps: [{ action: { op: "goto", path: "/inbox" }, ok }], expects: [], navigations: [{ url: "http://127.0.0.1:3000/inbox", status: 200 }] });
const planFor = (extra = {}) => ({
  ...binding,
  actions: [{ op: "goto", path: "/inbox" }],
  expect: [],
  authorFamily: "deepseek",
  verifierModel: "deepseek/deepseek-v4.1-flash",
  compare: true,
  bugfix: true,
  journeys: [{ journey: "change:repro", actions: [{ op: "goto", path: "/inbox" }], expect: [], base: null, planned: true }],
  ...extra,
});
const judgeDeps = (overrides = {}) => ({ plan: planFor(), evidence: { ...binding, journeys: [headRun()] }, picked: { model: "deepseek/deepseek-v4.1-flash" }, baseEvidence: { ...binding, journeys: [{ ...headRun(false) }] }, ask: () => ({ verdict: "PASS", notes: "saw it" }), ...overrides });

const cachedPlan = (steps, extra = {}) => planFor({
  journeys: [{ journey: "change:repro", actions: steps.map((step) => step.action), expect: [], base: cachedArea({ journey: "change:repro", steps, expects: [], ...extra }), planned: false }],
});
const apiBase = cachedPlan([{ action: { op: "api", method: "POST", path: "/api/mcp/tasks", body: {}, expectStatus: 200 }, ok: true }], { navigations: [] });
const judgeCases = [
  ["a repro that failed on base and passes on head is a pass", {}, "PASS"],
  ["a repro that also passed on base is not proof, so it fails", { baseEvidence: { ...binding, journeys: [headRun(true)] } }, "FAIL", /does not reproduce the bug/],
  ["a head journey that fails is a fail even when the model would pass it", { evidence: { ...binding, journeys: [headRun(false)] }, ask: () => ({ verdict: "PASS", notes: "looks fine" }) }, "FAIL"],
  ["no base evidence fails the comparison instead of passing it", { baseEvidence: null }, "FAIL", /base comparison did not run/],
  ["a cached base result stands in for a base run", { plan: cachedPlan([{ action: { op: "goto", path: "/inbox" }, ok: false }]), baseEvidence: null }, "PASS"],
  ["a cached api-only base that passed means the repro did not reproduce", { plan: apiBase, evidence: { ...binding, journeys: [{ ...apiBase.journeys[0].base, apiOnly: true }] }, baseEvidence: null }, "FAIL", /does not reproduce the bug/],
  ["a model failure on the head lane still fails the journey", { ask: () => ({ verdict: "FAIL", notes: "wrong total" }) }, "FAIL", /still fails on head/],
];
for (const [name, overrides, verdict, notes] of judgeCases) test(name, async () => {
  const judged = await (await load()).judgeJourneys(judgeDeps(overrides));
  assert.equal(judged.verdict, verdict);
  if (notes) assert.match(judged.notes, notes);
});

test("journey evidence must match the run binding", async () => {
  const verifier = await load();
  const body = { ...binding, journeys: [{ journey: "change:repro", steps: [], expects: [] }] };
  assert.equal(verifier.readJourneyEvidence(JSON.stringify(body), binding).journeys.length, 1);
  assert.throws(() => verifier.readJourneyEvidence(JSON.stringify({ ...body, run: "10" }), binding), /schema\/binding mismatch/);
  assert.throws(() => verifier.readJourneyEvidence(JSON.stringify({ ...body, journeys: [{ journey: "x", steps: [{ ok: "yes" }], expects: [] }] }), binding), /schema\/binding mismatch/);
});
