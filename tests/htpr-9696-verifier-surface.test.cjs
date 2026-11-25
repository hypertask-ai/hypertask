const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const load = () => import("../scripts/pstack-verifier.mjs");
const binding = { sha: "a".repeat(40), run: "9", attempt: "1" };
const BOARD = "/project?id={id}", TASK = "/detail/project-{id}/1";
const WELCOME = "src/components/AI_CHAT/WelcomeScreen.tsx";
const sources = [WELCOME, "src/app/chat/page.tsx", "src/app/detail/[...slug]/page.tsx", "src/app/detail/[...slug]/Panel.tsx"];
const readSource = (file) => ({
  "src/app/chat/page.tsx": 'import Welcome from "@/components/AI_CHAT/WelcomeScreen";',
  "src/app/detail/[...slug]/Panel.tsx": 'import Welcome from "@/components/AI_CHAT/WelcomeScreen";',
}[file] ?? "");
const request = { ...binding, baseSha: "b".repeat(40), title: "HTPR-9031 [IMPROVE] Ticket chat starters", body: "Author-Model: codex", diff: "", files: [WELCOME], filesTruncated: false, boardPath: BOARD, taskPath: TASK };
const open = (path) => ({ actions: [{ op: "goto", path }], expect: [{ path }], reason: "check chat" });
const deps = { binding, pages: [], sources, readSource };

test("changed screens include ticket chat and preserve dynamic seed identities", async () => {
  const { changedSurfaces } = await load();
  const routes = (files, extra = {}) => changedSurfaces({ files, ...deps, boardPath: BOARD, taskPath: TASK, ...extra }).map((item) => item.route);
  assert.deepEqual(routes([WELCOME]), ["/chat", TASK]);
  assert.deepEqual(routes(["src/lib/tasks/saveLimit.ts"]), []);
  for (const [segment, route] of [["agents/[agentId]", "/agents/{agent}"], ["trash/[projectId]", "/trash/{id}"], ["chat/[sessionId]", null], ["settings/[[...section]]", "/settings"]]) {
    const file = `src/app/${segment}/page.tsx`;
    assert.deepEqual(routes([file], { sources: [file] }), route ? [route] : []);
  }
});

test("colocated folders are not routes and tracing continues through app components", async () => {
  const { changedSurfaces } = await load();
  const widget = "src/app/widgets/search/UserSearch.tsx", nested = "src/app/reset/components/Search.tsx";
  const sources = [widget, nested, "src/app/reset/page.tsx", "src/app/dashboard/page.tsx"];
  const readSource = (file) => ({
    [nested]: 'import Search from "../../widgets/search/UserSearch";',
    "src/app/dashboard/page.tsx": 'import Search from "../reset/components/Search";',
  }[file] ?? "");
  const routes = (file) => changedSurfaces({ files: [file], sources, readSource }).map((item) => item.route);
  assert.deepEqual(routes(nested), ["/reset", "/dashboard"]);
  assert.deepEqual(routes(widget), ["/reset", "/dashboard"]);
});

test("a missed changed screen is retried once with feedback", async () => {
  const { planFromRequest } = await load();
  const prompts = [];
  const plan = await planFromRequest(request, { ...deps, ask(prompt) {
    prompts.push(prompt);
    return open(prompts.length === 1 ? "/agents/chat?view=rooms" : TASK);
  } });
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /DATA: CHANGED SCREENS\n\/chat\n\/detail\/project-\{id\}\/1/);
  assert.match(prompts[1], /Earlier try: The last plan opened no screen this diff changes\./);
  assert.deepEqual(plan.actions, open(TASK).actions);
  assert.deepEqual(plan.surfaces, ["/chat", TASK]);
  assert.equal(plan.unevaluated, "");
});

test("a second miss, empty plan, or click-only plan stays unevaluated", async () => {
  const { planFromRequest, decide, askNeeded } = await load();
  for (const answer of [open("/agents/chat"), { actions: [], expect: [], reason: "no user path" }, { actions: [{ op: "click", text: "Save" }], expect: [], reason: "save" }]) {
    let asked = 0;
    const plan = await planFromRequest(request, { ...deps, ask() { asked++; return answer; } });
    assert.equal(asked, 2);
    assert.equal(plan.unevaluated, `plan missed changed surface: /chat, ${TASK}`);
    assert.equal(askNeeded(plan), false);
    assert.equal(decide({ model: { verdict: "PASS" }, plan, binding, checksPassed: true }).verdict, "UNEVALUATED");
  }
});

test("a changed-screen or API-only plan needs no retry", async () => {
  const { planFromRequest } = await load();
  for (const answer of [open(TASK), { actions: [{ op: "api", method: "GET", path: "/api/mcp/tasks/{task}", body: {}, expectStatus: 200, expectText: "saved" }], expect: [], reason: "api seam" }]) {
    let asked = 0;
    const plan = await planFromRequest(request, { ...deps, ask() { asked++; return answer; } });
    assert.equal(asked, 1);
    assert.equal(plan.unevaluated, "");
  }
});

test("screen matching accepts descendants and seeded IDs, never ancestors or other chats", async () => {
  const { sameScreen } = await load();
  for (const [visited, changed, expected] of [["/project?id=1", "/project", true], ["/chat/{id}", "/chat", true], ["/agents", "/agents/{agent}", false], ["/agents/0b8f6f2e-1f3f-4a4e-9a1e-2c3d4e5f6a7b", "/agents/{agent}", true], ["/agents/chat?view=rooms", "/chat/{id}", false]]) {
    assert.equal(sameScreen(visited, changed), expected);
  }
});

test("agent goto and URL expectation both use the agent seed", async () => {
  const { runPlan } = await load();
  const base = "http://127.0.0.1:3100", agentId = "0b8f6f2e-1f3f-4a4e-9a1e-2c3d4e5f6a7b";
  const page = {
    async screenshot() {},
    async goto(url) { assert.equal(url, `${base}/agents/${agentId}`); return { status: () => 200, url: () => url }; },
    async waitForURL(match) { assert.equal(match(new URL(`${base}/agents/${agentId}`)), true); },
  };
  const result = await runPlan({ page, plan: open("/agents/{agent}"), base, projectId: "1", agentId, shotsDir: mkdtempSync(join(tmpdir(), "agent-url-")), navigations: [] });
  assert.deepEqual(result.steps.map((item) => item.ok), [true]);
  assert.deepEqual(result.expects.map((item) => item.ok), [true]);
});

test("error evidence and verdict notes identify changed and unrelated screens", async () => {
  const { runJourneys } = await load();
  const { decideHeadOnly } = require("../scripts/lib/pstack-compare.cjs");
  for (const [route, changed] of [[TASK.replace("{id}", "1"), true], ["/agents/chat?view=rooms", false]]) {
    const result = await runJourneys({ page: { evaluate: async () => "Something went wrong", url: () => `http://127.0.0.1:3000${route}` }, plan: { ...open(TASK), surfaces: [TASK] }, base: "http://127.0.0.1:3000", shotsRoot: mkdtempSync(join(tmpdir(), "surface-")), run: async () => ({ steps: [{ ok: false, error: "document status 500" }], expects: [] }) });
    const head = result.journeys[0];
    assert.deepEqual(head.errorScreen, { route, changed });
    const verdict = decideHeadOnly({ journeys: [{ journey: "change:primary", viewport: "desktop", plan: open(TASK), head }] });
    assert.match(verdict.notes, new RegExp(changed ? "this change touches" : "this change does not touch"));
  }
});
