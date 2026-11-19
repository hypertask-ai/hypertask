const assert = require("node:assert/strict");
const test = require("node:test");
const { traceImports } = require("../scripts/lib/pstack-journeys.cjs");

const load = () => import("../scripts/pstack-verifier.mjs");
const binding = { sha: "a".repeat(40), run: "9", attempt: "1" };
const BASE = "b".repeat(40);
const plan = (actions, extra = {}) => ({ ...binding, actions, expect: [], authorFamily: "grok", verifierModel: "deepseek/deepseek-v4.1-flash", ...extra });
const model = { model: "deepseek/deepseek-v4.1-flash" };

test("an api body placeholder that is the whole value becomes the seeded id number", async () => {
  const { fillApiBody } = await load();
  assert.deepEqual(fillApiBody({ project_id: "{archived}", title: "probe", nested: [{ id: "{task}" }], board: "{id}" }, "4", "7", "2"), { project_id: 2, title: "probe", nested: [{ id: 7 }], board: 4 });
  assert.deepEqual(fillApiBody({ note: "board {archived} was archived" }, "4", "7", "2"), { note: "board 2 was archived" });
  assert.throws(() => fillApiBody({ project_id: "{archived}" }, "4", "7", ""), /archived project id is not allowed/);
});

test("the planner sees the seeded fixtures, setup actions and the files that reach a screen", async () => {
  const { buildPrompt } = await load();
  const reach = [{ file: "src/pages/api/tasks/single.ts", via: ["src/lib/tasks/saveLimit.ts", "src/lib/api/task-writes/update.ts", "src/pages/api/tasks/single.ts"], pages: ["boards-and-views"] }];
  const prompt = buildPrompt({ kind: "plan", title: "HTPR-9399 [BUGFIX] Refuse new tickets on archived boards", body: "b", diff: "d", boardPath: "/project?id={id}", taskPath: "/detail/project-{id}/1", reach }, "<<<fence>>>");
  for (const expected of [/DATA: SEEDED FIXTURES/, /DATA: CHANGE REACHES/, /src\/pages\/api\/tasks\/single\.ts/, /boards-and-views/, /setup/, /becomes a number/, /\{archived\} is the seeded archived board/]) assert.match(prompt, expected);
});

test("a changed library file is traced through its importers to the page that uses it", () => {
  const sources = ["src/lib/tasks/saveLimit.ts", "src/lib/api/task-writes/update.ts", "src/pages/api/tasks/single.ts", "src/lib/internal/only.ts"];
  const readSource = (file) => ({
    "src/lib/api/task-writes/update.ts": 'import { taskSaveBudget } from "@/lib/tasks/saveLimit";',
    "src/pages/api/tasks/single.ts": 'import { save } from "../../../lib/api/task-writes/update";',
  }[file] ?? "");
  const pages = [{ name: "task-save", text: "Saving a task posts to `src/pages/api/tasks/single.ts`." }];
  const trace = traceImports({ files: ["src/lib/tasks/saveLimit.ts"], pages, sources, readSource });
  assert.deepEqual(trace.surfaces.map((item) => item.file), ["src/pages/api/tasks/single.ts"]);
  assert.deepEqual(trace.surfaces[0].pages, ["task-save"]);
  assert.deepEqual(trace.surfaces[0].via, ["src/lib/tasks/saveLimit.ts", "src/lib/api/task-writes/update.ts", "src/pages/api/tasks/single.ts"]);
  assert.deepEqual(traceImports({ files: ["src/lib/internal/only.ts"], pages: [], sources, readSource }).surfaces, []);
});

test("the real saveLimit change reaches a page even though no feature page names it", () => {
  const trace = traceImports({ files: ["src/lib/tasks/saveLimit.ts"], pages: [] });
  assert.ok(trace.surfaces.some((item) => /^src\/(?:pages|app)\//.test(item.file)), JSON.stringify(trace.surfaces));
});

test("a bug fix with no repro can be evaluated again, not failed", async () => {
  const { decide } = await load();
  const result = decide({ model: {}, plan: plan([], { reason: "the write route needs a state the planner cannot create", files: ["src/lib/mcp/tasks/services.ts"], filesTruncated: false, bugfix: true }), evidence: null, binding, checksPassed: true });
  assert.equal(result.verdict, "UNEVALUATED");
  assert.match(result.notes, /no repro journey/);
  assert.match(result.notes, /state the planner cannot create/);
});

test("a change that reaches a screen but gets no planned path is not failed on the change", async () => {
  const { decide } = await load();
  const extra = { reason: "no user path: library and test changes only", files: ["src/lib/tasks/saveLimit.ts", "tests/htpr-9106-save-limit.test.cjs"], filesTruncated: false, reachable: ["src/pages/api/tasks/single.ts"] };
  const result = decide({ model: {}, plan: plan([], extra), evidence: null, binding, checksPassed: true });
  assert.equal(result.verdict, "UNEVALUATED");
  assert.match(result.notes, /src\/pages\/api\/tasks\/single\.ts/);
  assert.match(result.notes, /library and test changes only/);
});

test("the revert that touches saveLimit is planned against the task save page", async () => {
  const { planFromRequest, decide } = await load();
  const request = {
    ...binding, author: "claude", title: "HTPR-9450 [INFRA] Revert PR 3709: merged around its verifier by mistake", body: "Author-Model: claude", diff: "",
    files: ["src/lib/tasks/saveLimit.ts", "tests/feature-flag-reconcile-workflow.test.cjs", "tests/htpr-9106-save-limit.test.cjs"], filesTruncated: false, baseSha: BASE,
    boardPath: "/project?id={id}", taskPath: "/detail/project-{id}/1",
  };
  const built = await planFromRequest(request, { binding, pages: [], entries: [], ask: () => ({ actions: [], expect: [], reason: "no user path: library and test changes only" }) });
  assert.ok(built.reachable.length > 0, JSON.stringify(built.reachable));
  const result = decide({ model: {}, plan: built, evidence: null, binding, checksPassed: true });
  assert.equal(result.verdict, "UNEVALUATED");
  assert.match(result.notes, /library and test changes only/);
});

test("the captured bug fix plan with no repro is could-not-evaluate, not a fail", async () => {
  const { judgeJourneys } = await load();
  const capturedPlan = {
    ...binding, bugfix: true, compare: true, actions: [], expect: [], verifierModel: model.model,
    reason: "no user path: the change only affects API/MCP write paths and server-side validation",
    journeys: [{ journey: "area:mcp-task-lookup", actions: [{ op: "goto", path: "/my-tasks" }], expect: [{ text: "Core actions smoke" }] }],
  };
  const run = {
    journey: "area:mcp-task-lookup", apiOnly: false, offOrigin: [],
    steps: [{ action: { op: "goto", path: "/my-tasks" }, ok: true, error: "" }],
    expects: [{ expect: { text: "Core actions smoke" }, ok: false, error: "text not visible" }],
    navigations: [{ url: "http://127.0.0.1:3100/my-tasks", status: 200 }],
  };
  const judged = await judgeJourneys({ plan: capturedPlan, binding, evidence: { ...binding, journeys: [run] }, picked: model, baseEvidence: { ...binding, journeys: [{ ...run, judged: "" }] }, ask: () => ({ verdict: "PASS", notes: "" }) });
  assert.equal(judged.verdict, "UNEVALUATED");
  assert.match(judged.notes, /no repro journey/);
  assert.match(judged.notes, /API\/MCP write paths/);
});
