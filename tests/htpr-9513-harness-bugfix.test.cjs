const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../scripts/pstack-verifier.mjs");
const binding = { sha: "a".repeat(40), run: "9", attempt: "1" };
const BASE = "b".repeat(40);
const ALT = "google/gemini-3.8-flash";
const request = (title, files) => ({
  ...binding, author: "deepseek", title, body: "Author-Model: deepseek", diff: "",
  files, filesTruncated: false, baseSha: BASE, boardPath: "/project?id={id}", taskPath: "/detail/project-{id}/1",
});
const green = (verifierMjs) => ({
  runs: verifierMjs.REQUIRED_CI_CONTEXTS.map((name) => ({ name, conclusion: "success" })),
  statuses: verifierMjs.REQUIRED_CI_CONTEXTS.map((context) => ({ context, state: "success" })),
});

test("harness files count as no app code, shipped files still do", async () => {
  const { hasAppCode, harnessOnlyBugfix } = await load();
  for (const file of ["scripts/pstack-verifier.mjs", "tests/x.test.cjs", ".github/workflows/ci-tests.yml", "docs/ci.md", "package.json", "package-lock.json", "eslint.config.mjs", "config/ci.json", "evals/x.test.mjs", "AGENTS.md"]) assert.equal(hasAppCode([file]), false, file);
  for (const file of ["src/app/page.tsx", "src/pages/api/tasks/single.ts", "src/lib/tasks/saveLimit.ts", "public/login-app-dark.png", "tokens.css", "next.config.js"]) assert.equal(hasAppCode([file]), true, file);
  assert.equal(harnessOnlyBugfix("HTPR-1 [BUGFIX] verifier gate", ["scripts/a.mjs", "package.json"]), true);
  assert.equal(harnessOnlyBugfix("HTPR-1 [INFRA] verifier gate", ["scripts/a.mjs"]), false);
  assert.equal(harnessOnlyBugfix("HTPR-1 [BUGFIX] save limit", ["src/lib/tasks/saveLimit.ts"]), false);
  assert.equal(harnessOnlyBugfix("HTPR-1 [BUGFIX] save limit", []), false);
});

test("a harness-only bug fix plans no journey and never asks the model", async () => {
  const { planFromRequest, decide, settleWaiting } = await load();
  let asked = 0;
  const plan = await planFromRequest(request("HTPR-9513 [BUGFIX] verifier asks for a repro it cannot use", ["scripts/pstack-verifier.mjs", "tests/pstack-verifier.test.cjs", "package.json"]), {
    binding, altModel: ALT, pages: [], ask: () => { asked += 1; return { actions: [], expect: [], reason: "no user path: harness only" }; },
  });
  assert.equal(asked, 0);
  assert.deepEqual(plan.actions, []);
  assert.deepEqual(plan.journeys, undefined);
  assert.equal(plan.bugfix, undefined);
  assert.equal(plan.reason, "no user path: no app code changed");
  const first = decide({ model: {}, plan, evidence: null, binding, checksPassed: false, checksPending: true });
  assert.deepEqual(first, { verdict: "PENDING", notes: "waiting for required checks" });
  const settled = settleWaiting({ ...green(await load()), now: Date.parse("2026-11-20T10:00:00Z") });
  assert.deepEqual([settled.verdict, settled.state], ["PASS+NOTES", "success"]);
  const passed = decide({ model: {}, plan, evidence: null, binding, checksPassed: true });
  assert.equal(passed.verdict, "PASS+NOTES");
  assert.match(passed.notes, /^no app path: no user path: no app code changed$/);
});

test("a harness-only bug fix captured with the old bugfix flag still takes the no-app path", async () => {
  const { decide } = await load();
  const plan = { ...binding, actions: [], expect: [], bugfix: true, claim: { title: "HTPR-9513 [BUGFIX] verifier asks for a repro" }, reason: "no user path: harness only", files: ["package.json", "scripts/pstack-verifier.mjs"], filesTruncated: false };
  const passed = decide({ model: {}, plan, evidence: null, binding, checksPassed: true });
  assert.equal(passed.verdict, "PASS+NOTES");
  assert.match(passed.notes, /^no app path: /);
});

test("an app bug fix still plans a change:repro journey", async () => {
  const { planFromRequest, planJourneys } = await load();
  const plan = await planFromRequest(request("HTPR-9513 [BUGFIX] a form loses its save button", ["src/app/page.tsx"]), {
    binding, altModel: ALT, pages: [], ask: () => ({ actions: [{ op: "goto", path: "/inbox" }], expect: [], reason: "" }),
  });
  assert.equal(plan.bugfix, true);
  assert.deepEqual(plan.journeys.map((item) => item.journey), ["change:repro"]);
  const primary = await planJourneys({ request: request("HTPR-9513 [BUGFIX] nothing app code", ["src/app/page.tsx"]), pages: [], ask: () => ({ actions: [{ op: "goto", path: "/inbox" }], expect: [] }), key: "", model: "", models: [], bugfix: false });
  assert.deepEqual(primary.items.map((item) => item.journey), ["change:primary"]);
});

test("an app bug fix with no planned repro is still unevaluated", async () => {
  const { planFromRequest, decide, judgeJourneys } = await load();
  const plan = await planFromRequest(request("HTPR-9513 [BUGFIX] the save route drops its last field", ["src/lib/tasks/saveLimit.ts"]), {
    binding, altModel: ALT, pages: [], ask: () => ({ actions: [], expect: [], reason: "no user path: the planner cannot build the state" }),
  });
  assert.equal(plan.bugfix, true);
  const result = decide({ model: {}, plan, evidence: null, binding, checksPassed: true });
  assert.equal(result.verdict, "UNEVALUATED");
  assert.match(result.notes, /no repro journey/);
  const captured = { ...binding, bugfix: true, actions: [], expect: [], verifierModel: ALT, claim: { title: "HTPR-9513 [BUGFIX] the save route drops its last field" }, files: ["src/lib/tasks/saveLimit.ts"], reason: "no user path: the planner cannot build the state", journeys: [{ journey: "area:boards-and-views", actions: [{ op: "goto", path: "/inbox" }], expect: [] }] };
  const run = { journey: "area:boards-and-views", apiOnly: false, offOrigin: [], steps: [{ action: { op: "goto", path: "/inbox" }, ok: true, error: "" }], expects: [], navigations: [{ url: "http://127.0.0.1:3100/inbox", status: 200 }] };
  const judged = await judgeJourneys({ plan: captured, evidence: { ...binding, journeys: [run] }, picked: { model: ALT }, ask: () => ({ verdict: "PASS", notes: "" }) });
  assert.equal(judged.verdict, "UNEVALUATED");
  assert.match(judged.notes, /no repro journey/);
});
