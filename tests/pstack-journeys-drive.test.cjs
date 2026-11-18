const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
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

test("a cached area journey is adopted with no model call for that page", async () => {
  const asked = [];
  const plan = await (await load()).planFromRequest(request(["src/pages/api/queues/inboxReminder.ts"]), {
    binding,
    mapSha: MAP,
    pages: [page("inbox", INBOX_PAGE)],
    entries: [cachedArea()],
    ask(prompt) {
      asked.push(prompt);
      return changePlan();
    },
  });
  assert.equal(asked.length, 1);
  assert.match(asked[0], /DATA: TITLE/);
  const area = plan.journeys.find((item) => item.journey === "area:inbox");
  assert.equal(area.planned, false);
  assert.deepEqual(area.actions, pagePlan().actions);
  assert.equal(area.base.ok, true);
});

test("a cached area journey for another base, map or page text is not adopted", async () => {
  const asked = [];
  const plan = await (await load()).planFromRequest(request(["src/pages/api/queues/inboxReminder.ts"]), {
    binding,
    mapSha: MAP,
    pages: [page("inbox", `${INBOX_PAGE} changed`)],
    entries: [cachedArea(), cachedArea({ baseSha: "d".repeat(40) }), cachedArea({ mapSha: "e".repeat(40) })],
    ask() {
      asked.push(1);
      return asked.length === 1 ? pagePlan() : changePlan();
    },
  });
  assert.equal(asked.length, 2);
  assert.equal(plan.journeys.find((item) => item.journey === "area:inbox").planned, true);
});

test("a change that matches no page plans only the change journey", async () => {
  const plan = await (await load()).planFromRequest(request(["src/lib/api/task-writes/create-global.ts"]), {
    binding,
    mapSha: MAP,
    pages: [page("inbox", INBOX_PAGE)],
    entries: [],
    ask: () => changePlan(),
  });
  assert.deepEqual(plan.journeys.map((item) => item.journey), ["change:repro"]);
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

test("a repro that failed on base and passes on head is a pass", async () => {
  const verdict = await (await load()).judgeJourneys(judgeDeps());
  assert.equal(verdict.verdict, "PASS");
});

test("a repro that also passed on base is not proof, so it fails", async () => {
  const verdict = await (await load()).judgeJourneys(judgeDeps({ baseEvidence: { ...binding, journeys: [headRun(true)] } }));
  assert.equal(verdict.verdict, "FAIL");
  assert.match(verdict.notes, /does not reproduce the bug/);
});

test("a head journey that fails is a fail even when the model would pass it", async () => {
  const verdict = await (await load()).judgeJourneys(judgeDeps({ evidence: { ...binding, journeys: [headRun(false)] }, ask: () => ({ verdict: "PASS", notes: "looks fine" }) }));
  assert.equal(verdict.verdict, "FAIL");
});

test("no base evidence fails the comparison instead of passing it", async () => {
  const verdict = await (await load()).judgeJourneys(judgeDeps({ baseEvidence: null }));
  assert.equal(verdict.verdict, "FAIL");
  assert.match(verdict.notes, /base comparison did not run/);
});

test("a cached base result stands in for a base run", async () => {
  const plan = planFor({ journeys: [{ journey: "change:repro", actions: [{ op: "goto", path: "/inbox" }], expect: [], base: cachedArea({ journey: "change:repro", steps: [{ action: { op: "goto", path: "/inbox" }, ok: false }], expects: [] }), planned: false }] });
  const verdict = await (await load()).judgeJourneys(judgeDeps({ plan, baseEvidence: null }));
  assert.equal(verdict.verdict, "PASS");
});

test("a model failure on the head lane still fails the journey", async () => {
  const verdict = await (await load()).judgeJourneys(judgeDeps({ ask: () => ({ verdict: "FAIL", notes: "wrong total" }) }));
  assert.equal(verdict.verdict, "FAIL");
  assert.match(verdict.notes, /still fails on head/);
});

test("journey evidence must match the run binding", async () => {
  const verifier = await load();
  const body = { ...binding, journeys: [{ journey: "change:repro", steps: [], expects: [] }] };
  assert.equal(verifier.readJourneyEvidence(JSON.stringify(body), binding).journeys.length, 1);
  assert.throws(() => verifier.readJourneyEvidence(JSON.stringify({ ...body, run: "10" }), binding), /schema\/binding mismatch/);
  assert.throws(() => verifier.readJourneyEvidence(JSON.stringify({ ...body, journeys: [{ journey: "x", steps: [{ ok: "yes" }], expects: [] }] }), binding), /schema\/binding mismatch/);
});
