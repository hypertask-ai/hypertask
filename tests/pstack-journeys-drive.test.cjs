const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");

const load = () => import("../scripts/pstack-verifier.mjs");
const binding = { sha: "a".repeat(40), run: "9", attempt: "1" };
const request = (files, extra = {}) => ({ ...binding, baseSha: "b".repeat(40), title: "HYP-1 [BUGFIX] Fix the inbox", body: "Author-Model: deepseek", diff: "", files, filesTruncated: false, boardPath: "/project?id={id}", taskPath: "/detail/project-{id}/1", ...extra });
const page = (name, text) => ({ name, text });
const INBOX_PAGE = "# Inbox\nInbox rows from `src/pages/api/queues/inboxReminder.ts`.";
const pagePlan = (reason = "page") => ({ actions: [{ op: "goto", path: "/inbox" }], expect: [{ text: "Inbox" }], reason });
const changePlan = () => ({ actions: [{ op: "goto", path: "/all-tasks" }], expect: [{ text: "All tasks" }], reason: "" });

test("a mapped page gets its own journey from the page text, then the change journey", async () => {
  const prompts = [];
  const plan = await (await load()).planFromRequest(request(["src/pages/api/queues/inboxReminder.ts"]), {
    binding,
    pages: [page("inbox", INBOX_PAGE)],
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
  assert.deepEqual(plan.journeys[1].actions, pagePlan().actions);
  assert.deepEqual(plan.actions, changePlan().actions);
});

test("a change that matches no page plans only the change journey", async () => {
  const plan = await (await load()).planFromRequest(request(["src/lib/api/task-writes/create-global.ts"]), {
    binding,
    pages: [page("inbox", INBOX_PAGE)],
    ask: () => changePlan(),
  });
  assert.deepEqual(plan.journeys.map((item) => item.journey), ["change:repro"]);
});

test("non-app changes still skip the model and carry no journeys", async () => {
  const plan = await (await load()).planFromRequest(request(["docs/ci.md"], { title: "HYP-2 [INFRA] Docs" }), { binding, pages: [], ask() { throw new Error("model"); } });
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

test("a failed plan never reaches the journeys, even with area journeys", async () => {
  const journeyMode = (await load()).journeyMode;
  const plan = { journeys: [{ journey: "area:inbox" }] };
  assert.deepEqual([true, false, false], [journeyMode(plan), journeyMode({ ...plan, fail: "the change plan failed" }), journeyMode({ ...plan, journeys: [] })]);
});

test("an api-only journey is marked so a missing document response is not a failure", async () => {
  const run = async () => ({ steps: [{ action: { op: "api", method: "GET", path: "/api/x", body: {}, expectStatus: 200 }, ok: true, error: "" }], expects: [] });
  const plan = { journeys: [{ journey: "change:primary", actions: [{ op: "api", method: "GET", path: "/api/x", body: {}, expectStatus: 200 }], expect: [] }] };
  const result = await (await load()).runJourneys({ page: {}, plan, base: "http://127.0.0.1:3000", shotsRoot: mkdtempSync(join(tmpdir(), "journeys-api-")), run });
  assert.equal(result.journeys[0].apiOnly, true);
});

const headRun = (journey, ok = true) => ({ journey, steps: [{ action: { op: "goto", path: "/inbox" }, ok }], expects: [], navigations: [{ url: "http://127.0.0.1:3000/inbox", status: 200 }] });
const journeyItem = (journey) => ({ journey, actions: [{ op: "goto", path: "/inbox" }], expect: [] });
const planFor = (journeys, extra = {}) => ({ ...binding, actions: [], expect: [], authorFamily: "deepseek", verifierModel: "deepseek/deepseek-v4.1-flash", journeys, ...extra });
const judgeDeps = (overrides = {}) => ({ plan: planFor([journeyItem("change:repro")], { bugfix: true }), evidence: { ...binding, journeys: [headRun("change:repro")] }, picked: { model: "deepseek/deepseek-v4.1-flash" }, ask: () => ({ verdict: "PASS", notes: "saw it" }), work: "", ...overrides });

test("a repro that passes on head is a pass", async () => {
  const judged = await (await load()).judgeJourneys(judgeDeps());
  assert.equal(judged.verdict, "PASS");
});

test("a repro that fails on head fails the pull request", async () => {
  const judged = await (await load()).judgeJourneys(judgeDeps({ evidence: { ...binding, journeys: [headRun("change:repro", false)] } }));
  assert.equal(judged.verdict, "FAIL");
  assert.match(judged.notes, /change:repro: failed at step 1/);
});

test("a head journey that is red in the newest nightly pass does not block", async () => {
  const judged = await (await load()).judgeJourneys({
    plan: planFor([journeyItem("area:inbox")]),
    evidence: { ...binding, journeys: [headRun("area:inbox", false)] },
    picked: { model: "deepseek/deepseek-v4.1-flash" },
    redFeatures: ["inbox"],
    ask: () => ({ verdict: "PASS", notes: "" }),
    work: "",
  });
  assert.equal(judged.verdict, "PASS+NOTES");
  assert.match(judged.notes, /already red on production/);
});

test("a head journey that fails while the nightly pass is green for it fails", async () => {
  const judged = await (await load()).judgeJourneys({
    plan: planFor([journeyItem("area:inbox")]),
    evidence: { ...binding, journeys: [headRun("area:inbox", false)] },
    picked: { model: "deepseek/deepseek-v4.1-flash" },
    redFeatures: [],
    ask: () => ({ verdict: "PASS", notes: "" }),
    work: "",
  });
  assert.equal(judged.verdict, "FAIL");
  assert.match(judged.notes, /area:inbox: failed at step 1/);
});

test("a model failure on a passing run still fails the journey", async () => {
  const judged = await (await load()).judgeJourneys(judgeDeps({ plan: planFor([journeyItem("area:inbox")]), evidence: { ...binding, journeys: [headRun("area:inbox")] }, ask: () => ({ verdict: "FAIL", notes: "wrong total" }) }));
  assert.equal(judged.verdict, "FAIL");
});

test("the nightly pass names the mapped pages it fails", async () => {
  const failedFeatures = (await load()).failedFeatures;
  const nightly = { graded: [{ area: "Inbox", file: "inbox.md", verdict: "fail" }, { area: "Boards", file: "boards-and-views.md", verdict: "pass" }, { area: "Agents", file: "agents.md", verdict: "not-drivable" }] };
  assert.deepEqual(failedFeatures(nightly), ["inbox"]);
  assert.deepEqual(failedFeatures(null), []);
});

test("journey evidence must match the run binding", async () => {
  const verifier = await load();
  const body = { ...binding, journeys: [{ journey: "change:repro", steps: [], expects: [] }] };
  assert.equal(verifier.readJourneyEvidence(JSON.stringify(body), binding).journeys.length, 1);
  assert.throws(() => verifier.readJourneyEvidence(JSON.stringify({ ...body, run: "10" }), binding), /schema\/binding mismatch/);
  assert.throws(() => verifier.readJourneyEvidence(JSON.stringify({ ...body, journeys: [{ journey: "x", steps: [{ ok: "yes" }], expects: [] }] }), binding), /schema\/binding mismatch/);
});

test("baseRedrivePlan selects only failed side journeys, tracks their failed viewports and enforces the cap of four", async () => {
  const { BASE_REDRIVE_LIMIT, baseRedrivePlan, readPlan } = await load();
  assert.equal(BASE_REDRIVE_LIMIT, 4);
  const items = [
    journeyItem("change:primary"),
    journeyItem("area:ok"),
    ...Array.from({ length: 5 }, (_, index) => journeyItem(`area:fail-${index + 1}`)),
  ];
  const plan = planFor(items, { viewports: ["desktop", "phone"] });
  const runAt = (journey, viewport, ok) => ({ ...headRun(journey, ok), viewport });
  const evidence = {
    ...binding,
    journeys: [
      runAt("change:primary", "desktop", false),
      runAt("change:primary", "phone", false),
      runAt("area:ok", "desktop", true),
      runAt("area:ok", "phone", true),
      runAt("area:fail-1", "desktop", true),
      runAt("area:fail-1", "phone", false),
      runAt("area:fail-2", "desktop", false),
      runAt("area:fail-2", "phone", false),
      runAt("area:fail-3", "desktop", false),
      runAt("area:fail-3", "phone", true),
      runAt("area:fail-4", "desktop", false),
      runAt("area:fail-4", "phone", false),
      runAt("area:fail-5", "desktop", false),
      runAt("area:fail-5", "phone", false),
    ],
  };
  const basePlan = baseRedrivePlan(plan, evidence);
  assert.deepEqual(basePlan.journeys.map((item) => item.journey), ["area:fail-1", "area:fail-2", "area:fail-3", "area:fail-4"]);
  assert.deepEqual(basePlan.journeys[0].viewports, ["phone"]);
  assert.deepEqual(basePlan.journeys[1].viewports, ["desktop", "phone"]);
  assert.deepEqual(basePlan.journeys[2].viewports, ["desktop"]);
  assert.deepEqual(basePlan.viewports, ["desktop", "phone"]);
  assert.equal(readPlan(JSON.stringify(basePlan), binding).journeys.length, 4);
  const onlyChangeFailed = baseRedrivePlan(planFor([journeyItem("change:primary"), journeyItem("area:ok")]), {
    ...binding,
    journeys: [headRun("change:primary", false), headRun("area:ok", true)],
  });
  assert.equal(onlyChangeFailed, null);
  assert.equal(baseRedrivePlan(plan, { ...binding, preview: "down", journeys: [] }), null);
});

test("basePlanCommand writes base-plan.json and signals needed only when a side journey fails", async () => {
  const { basePlanCommand } = await load();
  const fs = require("node:fs");
  const work = mkdtempSync(join(tmpdir(), "base-plan-cmd-"));
  const outFile = join(work, "github-output");
  const previousOut = process.env.GITHUB_OUTPUT;
  fs.mkdirSync(join(work, "plan"), { recursive: true });
  fs.mkdirSync(join(work, "evidence"), { recursive: true });
  try {
    process.env.GITHUB_OUTPUT = outFile;
    fs.writeFileSync(outFile, "");
    const plan = planFor([journeyItem("change:primary"), journeyItem("area:ci-runner-policy")]);
    fs.writeFileSync(join(work, "plan", "plan.json"), JSON.stringify(plan));
    fs.writeFileSync(join(work, "evidence", "evidence.json"), JSON.stringify({ ...binding, journeys: [headRun("change:primary", true), headRun("area:ci-runner-policy", true)] }));
    assert.equal(basePlanCommand({ work, binding }), null);
    assert.match(fs.readFileSync(outFile, "utf8"), /needed=false/);
    assert.equal(fs.existsSync(join(work, "plan", "base-plan.json")), false);

    fs.writeFileSync(outFile, "");
    fs.writeFileSync(join(work, "evidence", "evidence.json"), JSON.stringify({ ...binding, journeys: [headRun("change:primary", true), headRun("area:ci-runner-policy", false)] }));
    const written = basePlanCommand({ work, binding });
    assert.deepEqual(written.journeys.map((item) => item.journey), ["area:ci-runner-policy"]);
    assert.match(fs.readFileSync(outFile, "utf8"), /needed=true/);
    assert.deepEqual(JSON.parse(fs.readFileSync(join(work, "plan", "base-plan.json"), "utf8")).journeys.map((item) => item.journey), ["area:ci-runner-policy"]);
  } finally {
    if (previousOut === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = previousOut;
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test("judge-ask asks nothing when the plan needs no drive, so a plan without evidence still settles", async () => {
  const { judgeAskCommand, decide } = await load();
  const fs = require("node:fs");
  const work = mkdtempSync(join(tmpdir(), "judge-ask-nodrive-"));
  fs.mkdirSync(join(work, "plan"), { recursive: true });
  try {
    const plan = planFor([], { bugfix: true, reachable: [], files: ["src/app/api/cron/search-index-drift/route.ts"] });
    fs.writeFileSync(join(work, "plan", "plan.json"), JSON.stringify(plan));
    const asked = await judgeAskCommand({ work, binding, picked: { model: "deepseek/deepseek-v4.1-flash" }, ask: () => { throw new Error("asked with no evidence"); } });
    assert.equal(asked, null);
    assert.equal(decide({ plan: { ...plan, reason: "no user path" }, evidence: null, binding, checksPassed: true, reproFirstPassed: true }).verdict, "PASS+NOTES");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test("judge-ask answers nothing when a drive plan left no evidence to judge", async () => {
  const { judgeAskCommand, basePlanCommand } = await load();
  const fs = require("node:fs");
  const work = mkdtempSync(join(tmpdir(), "judge-ask-empty-"));
  const outFile = join(work, "github-output");
  const previousOut = process.env.GITHUB_OUTPUT;
  fs.mkdirSync(join(work, "plan"), { recursive: true });
  try {
    process.env.GITHUB_OUTPUT = outFile;
    fs.writeFileSync(outFile, "");
    fs.writeFileSync(join(work, "plan", "plan.json"), JSON.stringify(planFor([journeyItem("change:primary")])));
    const asked = [];
    assert.equal(await judgeAskCommand({ work, binding, picked: { model: "deepseek/deepseek-v4.1-flash" }, ask: (prompt) => { asked.push(prompt); return { verdict: "PASS", notes: "" }; } }), null);
    assert.equal(asked.length, 0);
    assert.equal(basePlanCommand({ work, binding }), null);
    assert.match(fs.readFileSync(outFile, "utf8"), /needed=false/);
  } finally {
    if (previousOut === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = previousOut;
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test("judge-ask records the model verdict so a judge-only side journey failure is re-driven on the base", async () => {
  const { judgeAskCommand, basePlanCommand, judgeJourneys } = await load();
  const fs = require("node:fs");
  const work = mkdtempSync(join(tmpdir(), "judge-ask-"));
  const outFile = join(work, "github-output");
  const previousOut = process.env.GITHUB_OUTPUT;
  fs.mkdirSync(join(work, "plan"), { recursive: true });
  fs.mkdirSync(join(work, "evidence"), { recursive: true });
  try {
    process.env.GITHUB_OUTPUT = outFile;
    fs.writeFileSync(outFile, "");
    const plan = planFor([journeyItem("change:primary"), journeyItem("area:ci-runner-policy")]);
    fs.writeFileSync(join(work, "plan", "plan.json"), JSON.stringify(plan));
    fs.writeFileSync(join(work, "evidence", "evidence.json"), JSON.stringify({ ...binding, journeys: [headRun("change:primary"), headRun("area:ci-runner-policy")] }));
    assert.equal(basePlanCommand({ work, binding }), null);
    const asked = [];
    await judgeAskCommand({ work, binding, picked: { model: "deepseek/deepseek-v4.1-flash" }, ask: (prompt) => { asked.push(prompt); return asked.length === 1 ? { verdict: "PASS", notes: "the new total is right" } : { verdict: "FAIL", notes: "the same wrong total is on production" }; } });
    assert.equal(asked.length, 2);
    const recorded = JSON.parse(fs.readFileSync(join(work, "evidence", "evidence.json"), "utf8"));
    assert.deepEqual(recorded.journeys.map((run) => run.judged), ["PASS", "FAIL"]);
    const written = basePlanCommand({ work, binding });
    assert.deepEqual(written.journeys.map((item) => item.journey), ["area:ci-runner-policy"]);
    let reasked = 0;
    const judged = await judgeJourneys({
      plan,
      evidence: recorded,
      baseEvidence: { ...binding, journeys: [headRun("area:ci-runner-policy", false)] },
      picked: { model: "deepseek/deepseek-v4.1-flash" },
      ask: () => { reasked += 1; return { verdict: "PASS", notes: "" }; },
      reuseJudged: true,
      work: "",
    });
    assert.equal(reasked, 0);
    assert.equal(judged.verdict, "PASS+NOTES");
    assert.match(judged.notes, /area:ci-runner-policy also fails on production/);
  } finally {
    if (previousOut === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = previousOut;
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test("judgeJourneys excuses failed side journeys that also fail on production base and blocks real regressions", async () => {
  const { judgeJourneys } = await load();
  const plan = planFor([journeyItem("change:primary"), journeyItem("area:ci-runner-policy")]);
  const headEvidence = { ...binding, journeys: [headRun("change:primary", true), headRun("area:ci-runner-policy", false)] };
  const bothRed = await judgeJourneys({
    plan,
    evidence: headEvidence,
    baseEvidence: { ...binding, journeys: [headRun("area:ci-runner-policy", false)] },
    picked: { model: "deepseek/deepseek-v4.1-flash" },
    ask: () => ({ verdict: "PASS", notes: "" }),
    work: "",
  });
  assert.equal(bothRed.verdict, "PASS+NOTES");
  assert.match(bothRed.notes, /area:ci-runner-policy also fails on production/);
  const headOnlyRed = await judgeJourneys({
    plan,
    evidence: headEvidence,
    baseEvidence: { ...binding, journeys: [headRun("area:ci-runner-policy", true)] },
    picked: { model: "deepseek/deepseek-v4.1-flash" },
    ask: () => ({ verdict: "PASS", notes: "" }),
    work: "",
  });
  assert.equal(headOnlyRed.verdict, "FAIL");
  assert.match(headOnlyRed.notes, /area:ci-runner-policy: failed at step 1/);
  const changeRed = await judgeJourneys({
    plan,
    evidence: { ...binding, journeys: [headRun("change:primary", false), headRun("area:ci-runner-policy", false)] },
    baseEvidence: { ...binding, journeys: [headRun("change:primary", false), headRun("area:ci-runner-policy", false)] },
    picked: { model: "deepseek/deepseek-v4.1-flash" },
    ask: () => ({ verdict: "PASS", notes: "" }),
    work: "",
  });
  assert.equal(changeRed.verdict, "FAIL");
  assert.match(changeRed.notes, /change:primary: failed at step 1/);
});
