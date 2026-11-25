const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const load = () => import("../scripts/pstack-verifier.mjs");
const binding = { sha: "a".repeat(40), run: "9", attempt: "1" };
const CASES = JSON.parse(readFileSync(join(__dirname, "fixtures", "pstack-verifier", "plan-selectors-loading-cases.json"), "utf8"));
const request = (files, title = "HTPR-9670 [IMPROVE] Phone chat composer keeps its mic") => ({
  ...binding,
  baseSha: "b".repeat(40),
  title,
  body: "",
  diff: "",
  files,
  filesTruncated: false,
  boardPath: "/project?id={id}",
  taskPath: "/detail/project-{id}/1",
});

test("an icon-only control is clicked by its accessible name or data-testid, never by text it does not show", async () => {
  const { review } = await import("../scripts/lib/pstack-ground.cjs");
  const item = CASES["pr-3844-icon-only-dictation"];
  const checked = review({ journeys: item.journeys, corpus: item.corpus, routes: item.routes });
  assert.deepEqual(checked.problems, item.problems, item.why);
  assert.deepEqual(checked.dropped, item.dropped);
});

test("the planner is given the real selectors of the changed components", async () => {
  const { planFromRequest } = await load();
  const ground = CASES["pr-3844-icon-only-dictation"];
  const prompts = [];
  const plan = await planFromRequest(request(["src/components/AI_CHAT/AI_Tiptap_Container.tsx"]), {
    binding,
    pages: [],
    ground,
    ask(prompt) {
      prompts.push(prompt);
      return { actions: [{ op: "goto", path: "/chat" }, { op: "click", text: "Start dictation" }], expect: [{ path: "/chat" }], reason: "the mic on the phone composer" };
    },
  });
  assert.match(prompts[0], /DATA: REAL CONTROLS IN THE HEAD SOURCE/);
  assert.match(prompts[0], /data-testid: chat-mic, chat-mic-agent, chat-mic-user/);
  assert.match(prompts[0], /accessible names \(aria-label/);
  assert.match(prompts[0], /placeholder \(not visible text, never expect it\): Message/);
  assert.match(prompts[0], /An icon-only control has no visible text/);
  assert.deepEqual(plan.actions, [{ op: "goto", path: "/chat" }, { op: "click", text: "Start dictation" }]);
  assert.equal(plan.unevaluated, "");
});

test("a plan that clicks text the component does not show gets one re-plan that names the step", async () => {
  const { planFromRequest } = await load();
  const item = CASES["pr-3844-icon-only-dictation"];
  const answers = [
    { actions: item.journeys[0].actions, expect: [{ path: "/chat" }], reason: "the mic" },
    { actions: [{ op: "goto", path: "/chat" }, { op: "click", testid: "chat-mic" }], expect: [{ path: "/chat" }], reason: "the mic by test id" },
  ];
  const prompts = [];
  const plan = await planFromRequest(request(["src/components/AI_CHAT/AI_Tiptap_Container.tsx"]), {
    binding,
    pages: [],
    ground: item,
    ask(prompt) { prompts.push(prompt); return answers[Math.min(prompts.length - 1, answers.length - 1)]; },
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /change:primary step 2 click: "Mic" is not in the head source/);
  assert.deepEqual(plan.actions, [{ op: "goto", path: "/chat" }, { op: "click", testid: "chat-mic" }]);
  assert.equal(plan.unevaluated, "");
});

test("a click by data-testid is carried through the plan and a made up one is refused", async () => {
  const { allowAction } = await load();
  assert.deepEqual(allowAction({ op: "click", testid: "chat-mic" }), { op: "click", testid: "chat-mic" });
  assert.throws(() => allowAction({ op: "click", testid: "chat mic!" }), /testid is not allowed/);
});
