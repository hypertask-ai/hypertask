const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const load = () => import("../scripts/pstack-verifier.mjs");
const loading = () => require("../scripts/lib/pstack-loading.cjs");
const binding = { sha: "a".repeat(40), run: "9", attempt: "1" };
const chatPage = (over = {}) => ({
  goto: async (url) => ({ status: () => 200, url: () => url }),
  screenshot: async () => {},
  locator: () => ({ first() { return this; }, waitFor: async () => {} }),
  getByText: () => ({ first: () => ({ waitFor: async () => {} }) }),
  ...over,
});
const runPlanArgs = (page, settle, expect = [{ text: "Message" }]) => ({
  page,
  plan: { actions: [{ op: "goto", path: "/chat" }, { op: "shot", name: "mic" }], expect },
  base: "http://127.0.0.1:3100",
  projectId: "1",
  taskId: "2",
  bearer: "",
  agentBearer: "",
  archivedProjectId: "3",
  agentId: "",
  shotsDir: "/tmp/htpr-9691-shots",
  navigations: [],
  settle,
});

test("the loading wait clears a spinner and stops at its own bound", async () => {
  const { waitForLoadingGone } = loading();
  const answers = ["Loading AI chat", "Loading AI chat", ""];
  const cleared = await waitForLoadingGone({}, { read: async () => answers.shift() ?? "", sleep: async () => {}, timeoutMs: 1000 });
  assert.equal(cleared.settled, true);
  assert.equal(cleared.label, "");
  const stuck = await waitForLoadingGone({}, { read: async () => "Loading AI chat", sleep: async () => {}, timeoutMs: 0 });
  assert.deepEqual([stuck.settled, stuck.label], [false, "Loading AI chat"]);
});

test("the loading wait watches the states the app actually renders", () => {
  const { LOADING_SELECTOR, LOADING_LABELS, LOADING_READ } = loading();
  for (const part of ['aria-busy="true"', 'role="progressbar"', 'data-testid="full-screen-chat-loading"']) assert.ok(LOADING_SELECTOR.includes(part), part);
  assert.match(LOADING_READ, /\[role="status"\]/);
  assert.ok(LOADING_LABELS.includes("Loading AI chat"));
  const source = readFileSync(join(__dirname, "..", "src", "components", "AI_CHAT", "FullScreenChatLoading.tsx"), "utf8");
  assert.match(source, /role="status"/);
  assert.match(source, /"Loading AI chat"/);
});

test("a screenshot and a text check wait for the spinner to clear", async () => {
  const { runPlan } = await load();
  const order = [];
  const page = chatPage({ screenshot: async ({ path }) => { order.push(`shot:${path.split("/").pop()}`); } });
  const still = runPlanArgs(page, async () => { order.push("settle"); return { settled: false, label: "Loading AI chat" }; });
  const loadingRun = await runPlan(still);
  assert.deepEqual(order.slice(0, 2), ["settle", "shot:0.png"]);
  assert.equal(loadingRun.steps[1].note, "page still loading: Loading AI chat");
  assert.equal(loadingRun.expects[0].ok, false);
  assert.equal(loadingRun.expects[0].note, "page still loading: Loading AI chat");
  const settledRun = await runPlan(runPlanArgs(page, async () => ({ settled: true, label: "" })));
  assert.ok(settledRun.steps.every((step) => step.note == null));
  assert.equal(settledRun.expects[0].ok, true);
});

test("a change whose only failure is a page still loading is not judged a failure", async () => {
  const { decide } = await load();
  const actions = [{ op: "goto", path: "/chat" }, { op: "shot", name: "mic" }];
  const expect = [{ text: "Message" }];
  const plan = { ...binding, actions, expect, authorFamily: "grok", verifierModel: "deepseek/deepseek-v4.1-flash" };
  const evidence = {
    ...binding,
    steps: [{ action: actions[0], ok: true, error: "" }, { action: actions[1], ok: true, error: "", note: "page still loading: Loading AI chat" }],
    expects: [{ expect: expect[0], ok: false, error: "page still loading", note: "page still loading: Loading AI chat" }],
    navigations: [{ url: "http://127.0.0.1:3100/chat", status: 200 }],
    offOrigin: [],
  };
  const result = decide({ model: { verdict: "FAIL", notes: "the screenshot is a spinner" }, plan, evidence, binding });
  assert.equal(result.verdict, "UNEVALUATED");
  assert.match(result.notes, /^page still loading: page still loading: Loading AI chat/);
  const real = decide({ model: { verdict: "FAIL", notes: "the composer never showed" }, plan, evidence: { ...evidence, expects: [{ expect: expect[0], ok: false, error: "text not visible" }] }, binding });
  assert.equal(real.verdict, "FAIL");
});

test("a journey whose only failure is a page still loading is unevaluated, not a failure", async () => {
  const { decideHeadOnly, classifyRun } = require("../scripts/lib/pstack-compare.cjs");
  const { worthAsking } = await load();
  const { LOADING_NOTE } = loading();
  const loadingRun = {
    steps: [{ action: { op: "goto", path: "/chat" }, ok: true }, { action: { op: "shot", name: "mic" }, ok: true, note: `${LOADING_NOTE}: Loading AI chat` }],
    expects: [{ expect: { text: "Message" }, ok: false, error: LOADING_NOTE, note: `${LOADING_NOTE}: Loading AI chat` }],
    navigations: [{ url: "http://127.0.0.1:3100/chat", status: 200 }],
    offOrigin: [],
    judged: "",
  };
  assert.deepEqual(classifyRun(loadingRun, null), { state: "unjudged", failIndex: -1, loading: true });
  const plan = { actions: [{ op: "goto", path: "/chat" }], expect: [{ text: "Message" }], authorFamily: "grok", verifierModel: "deepseek/deepseek-v4.1-flash" };
  assert.equal(worthAsking(plan, plan, loadingRun, { model: plan.verifierModel }), false);
  const result = decideHeadOnly({ journeys: [{ journey: "change:primary", plan, head: loadingRun }] });
  assert.equal(result.verdict, "UNEVALUATED");
  assert.match(result.notes, /change:primary: page still loading ran past the wait/);
  const mixed = decideHeadOnly({
    journeys: [{
      journey: "change:primary",
      plan,
      head: { ...loadingRun, expects: [...loadingRun.expects, { expect: { text: "Send" }, ok: false, error: "text not visible" }] },
    }],
  });
  assert.equal(mixed.verdict, "FAIL");
  assert.match(mixed.notes, /change:primary: failed at step 3/);
  assert.equal(mixed.notes.includes("page still loading"), false);
});
