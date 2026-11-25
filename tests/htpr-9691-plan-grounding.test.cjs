const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const load = () => import("../scripts/pstack-verifier.mjs");
const binding = { sha: "a".repeat(40), run: "9", attempt: "1" };
const CASES = JSON.parse(readFileSync(join(__dirname, "fixtures", "pstack-verifier", "plan-grounding-cases.json"), "utf8"));
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

test("every grounding fixture is read the way the head source reads", async () => {
  const { review } = await import("../scripts/lib/pstack-ground.cjs");
  for (const [name, item] of Object.entries(CASES)) {
    const checked = review({ journeys: item.journeys, corpus: item.corpus, routes: item.routes, fixtures: "" });
    assert.deepEqual(checked.problems, item.problems, `${name}: ${item.why}`);
    assert.deepEqual(checked.dropped, item.dropped, `${name}: ${item.why}`);
  }
});

test("an unreadable head source checks no text and still rejects made up routes", async () => {
  const { review } = await import("../scripts/lib/pstack-ground.cjs");
  const found = review({ journeys: [{ journey: "change:primary", actions: [{ op: "click", text: "Anything" }, { op: "api", method: "GET", path: "/api/mcp/tasks/{task}", body: {}, expectStatus: 200, expectText: "" }], expect: [{ text: "Anything at all" }] }], corpus: "", routes: ["src/pages/api/chat/index.ts"] });
  assert.deepEqual(found.problems, ["change:primary step 2 api: /api/mcp/tasks/{task} is not a route in the head source"]);
  assert.equal(found.readable, false);
});

test("made up text gets one re-plan that names the offending step", async () => {
  const { planFromRequest } = await load();
  const bad = CASES["pr-3846-made-up-selectors"];
  const answers = [
    { actions: bad.journeys[0].actions, expect: bad.journeys[0].expect, reason: "the palette" },
    { actions: [{ op: "fill", label: "Describe the task", value: "fix login bug" }, { op: "click", text: "Send" }], expect: [{ text: "Describe the task" }], reason: "the writer field" },
  ];
  const prompts = [];
  const plan = await planFromRequest(request(["src/lib/tasks/writer.ts"], "HTPR-9684 [IMPROVE] Task writer names its field"), {
    binding,
    pages: [],
    ground: bad,
    ask(prompt) { prompts.push(prompt); return answers[Math.min(prompts.length - 1, answers.length - 1)]; },
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /Earlier try: The head source holds only these names/);
  assert.match(prompts[1], /step 2 click: "New Task" is not in the head source/);
  assert.deepEqual(plan.actions, [{ op: "fill", label: "Describe the task", value: "fix login bug" }, { op: "click", text: "Send" }]);
  assert.equal(plan.unevaluated, "");
});

test("a plan that still names text the source lacks is not sure, not a failure", async () => {
  const { planFromRequest, decide } = await load();
  const bad = CASES["pr-3349-error-wording"];
  const answer = { actions: bad.journeys[0].actions, expect: bad.journeys[0].expect, reason: "the preference route" };
  const plan = await planFromRequest({ ...request(["src/lib/ai/model-preference.ts"], "HTPR-9019 [IMPROVE] Model preference names its model"), author: "grok" }, {
    binding,
    altModel: "deepseek/deepseek-v4.1-flash",
    pages: [],
    ground: bad,
    ask() { return answer; },
  });
  assert.match(plan.unevaluated, /^plan used text\/selector not in source: change:primary step 1 api: "Invalid model preference" is not in the head source/);
  assert.equal(decide({ plan, evidence: null, binding }).verdict, "UNEVALUATED");
});

test("a plan whose only step is an unforceable failure is not sure, not a failure", async () => {
  const { planFromRequest } = await load();
  const answer = {
    actions: [{ op: "goto", path: "/project?id={id}" }],
    expect: [{ text: "Could not write your ticket" }],
    reason: "the writer error path",
  };
  const plan = await planFromRequest(request(["src/lib/tasks/writer.ts"], "HTPR-9684 [IMPROVE] Task writer names its field"), {
    binding,
    pages: [],
    ground: CASES["pr-3846-made-up-selectors"],
    ask() { return answer; },
  });
  assert.match(plan.unevaluated, /^plan expected a failure it cannot force: change:primary expect 1: expects an error and names no way to force it \(dropped\)/);
});


test("the head source is read from the pull request's own commit", async () => {
  const { headGrounding, groundingFiles } = await load();
  const sha = "c".repeat(40);
  const asked = [];
  const call = (args) => {
    asked.push(args[1]);
    if (args[1].includes("/git/trees/")) return JSON.stringify({ tree: [{ type: "blob", path: "src/pages/api/mcp/tasks/[id].ts" }, { type: "tree", path: "src" }] });
    return JSON.stringify({ content: Buffer.from('<button aria-label="Start dictation" />').toString("base64") });
  };
  const files = groundingFiles(["src/components/AI_CHAT/AI_Tiptap_Container.tsx", "tests/x.test.ts"], [{ via: ["src/components/AI_CHAT/AI_Tiptap_Container.tsx", "src/app/chat/ChatClient.tsx"] }]);
  assert.deepEqual(files, ["src/components/AI_CHAT/AI_Tiptap_Container.tsx", "src/app/chat/ChatClient.tsx"]);
  const ground = headGrounding({ repo: "acme/app", sha, files, call });
  assert.equal(ground.routes.length, 1);
  assert.match(ground.corpus, /aria-label="Start dictation"/);
  assert.ok(asked.every((url) => url.includes(sha)));
  assert.deepEqual(headGrounding({ repo: "", sha, files, call: () => { throw new Error("no call"); } }), { corpus: "", routes: [] });
});
