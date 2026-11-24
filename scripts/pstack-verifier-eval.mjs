import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { FLASH, buildPrompt, completeWithOpenRouter, drivePlan, judgeJourneys, parseAnswer, parsePlan, pickVerifier, readJourneyEvidence, redact } from "./pstack-verifier.mjs";

export { FLASH };
export const EVAL_BINDING = { sha: "b".repeat(40), run: "1", attempt: "1" };
export const EVAL_REPO_FILES = ["src/app/project/field-list.tsx"];
export const EVAL_VIEWPORTS = ["desktop", "phone"];
export const EVAL_JOURNEY = "change:primary";

const claim = {
  title: "HTPR-0000 [BUGFIX] A saved project field appears in the field list",
  body: "A user adds a field named Renewal date on the project page. After saving, the field list shows Renewal date. Today it shows the empty state instead.",
  diff: "diff --git a/src/app/project/field-list.tsx b/src/app/project/field-list.tsx\n+  const fields = useProjectFields(projectId);\n-  const fields = [];\n",
  boardPath: "/project?id={id}",
  taskPath: "/detail/project-{id}/1",
};

const actions = [
  { op: "goto", path: "/project?id={id}" },
  { op: "click", text: "Add field" },
  { op: "fill", label: "Field name", value: "Renewal date" },
  { op: "press", key: "Enter" },
];

const navigations = [{ url: "http://127.0.0.1:3100/project?id=1", status: 200 }];

export const CASES = [
  {
    name: "planted-bug",
    expected: "FAIL",
    why: "The saved field name is not on the page, so the claimed behaviour is broken.",
    claim,
    pageShows: { desktop: false, phone: false },
    plan: { actions, expect: [{ text: "Renewal date" }] },
  },
  {
    name: "planted-phone-bug",
    expected: "FAIL",
    why: "The saved field name is on the desktop page and missing at phone width, which is the planted phone bug.",
    claim,
    pageShows: { desktop: true, phone: false },
    plan: { actions, expect: [{ text: "Renewal date" }] },
  },
  {
    name: "clean",
    expected: "PASS",
    why: "The saved field name is on the page at desktop and phone width, so the claimed behaviour works.",
    claim,
    pageShows: { desktop: true, phone: true },
    plan: { actions, expect: [{ text: "Renewal date" }] },
  },
];

const FIXTURE_FORM = `
<button type="button">Add field</button>
<label>Field name <input type="text" name="field"></label>
<p id="saved-field">Renewal date</p>`;
const fixturePage = (style) => `<!doctype html>
<html lang="en">
<head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${style}</style></head>
<body>${FIXTURE_FORM}</body>
</html>`;

export const PHONE_ONLY_BUG_HTML = fixturePage("#saved-field { display: none; } @media (min-width: 600px) { #saved-field { display: block; } }");
export const FIELD_ON_EVERY_SIZE_HTML = fixturePage("#saved-field { display: block; }");

export const DRIVEN_CASE = {
  ...CASES.find((item) => item.name === "planted-phone-bug"),
  name: "planted-phone-bug-driven",
  why: "The page hides the saved field below 600px, so the real drive passes at desktop and fails on the phone lane.",
};

export async function fixtureServer(html) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => server.close(done)) };
}

export function drivenPlan(item = DRIVEN_CASE, model = FLASH) {
  const plan = item.plan ?? { actions: [], expect: [] };
  const actions = plan.actions.map((action) => (action.op === "goto" ? { ...action, path: "/" } : action));
  return evalPlan(item, model, { ...plan, actions });
}

export async function driveEvalEvidence({ item = DRIVEN_CASE, html = PHONE_ONLY_BUG_HTML, work = "" } = {}) {
  const root = work || mkdtempSync(path.join(tmpdir(), "pstack-drive-"));
  const server = await fixtureServer(html);
  const browser = await chromium.launch({ headless: true });
  try {
    const drive = await drivePlan({ browser, projectId: "1", plan: drivenPlan(item), base: server.base, shotsRoot: path.join(root, "shots"), origin: server.base });
    return readJourneyEvidence(JSON.stringify({ ...EVAL_BINDING, ...drive }), EVAL_BINDING);
  } finally {
    await browser.close();
    await server.close();
    if (!work) rmSync(root, { recursive: true, force: true });
  }
}

export async function judgeDrivenCase({ item = DRIVEN_CASE, model = FLASH, ask = async () => ({ verdict: "PASS", notes: "The saved field is visible." }) } = {}) {
  const evidence = await driveEvalEvidence({ item });
  const result = await judgeJourneys({ plan: drivenPlan(item, model), evidence, picked: { model }, ask, work: "" });
  return { case: item.name, model, expected: "FAIL", verdict: result.verdict, notes: result.notes, ok: result.verdict === "FAIL", evidence };
}

export function evalModels(alt) {
  const primary = pickVerifier("grok", alt);
  const alternate = pickVerifier("deepseek", alt);
  if (primary.fail || alternate.fail) throw new Error(alternate.fail ?? primary.fail);
  if (primary.model === alternate.model) throw new Error("the two model families must differ");
  return [primary.model, alternate.model];
}

export function promptFor(item, plan, evidence) {
  return buildPrompt({ kind: "judge", ...item.claim, plan, evidence });
}

function matches(item, verdict) {
  return item.expected === "PASS" ? verdict === "PASS" || verdict === "PASS+NOTES" : verdict === item.expected;
}

export function evalPlan(item, model, plan = item.plan) {
  if (!item?.claim) throw new Error("eval case is missing");
  return {
    ...EVAL_BINDING,
    authorFamily: String(model).startsWith("deepseek/") ? "deepseek" : "other",
    verifierModel: model,
    actions: plan.actions,
    expect: plan.expect,
    reason: "",
    viewports: EVAL_VIEWPORTS,
    journeys: [{ journey: EVAL_JOURNEY, page: "", actions: plan.actions, expect: plan.expect }],
  };
}

export function planPromptFor(item) {
  return buildPrompt({ kind: "plan", ...item.claim });
}

export function planCoversFixture(plan, value = "Renewal date") {
  const fillsField = plan.actions.some((action) => action.op === "fill" && action.value === value);
  const watchesField = plan.expect.some((expect) => expect.text === value);
  return fillsField && watchesField;
}

function showsOn(shown, viewport) {
  if (shown && typeof shown === "object") return shown[viewport] === true;
  return shown === true;
}

function evalRun(item, plan, viewport, shown) {
  const visible = showsOn(shown, viewport);
  const failedStep = Number.isInteger(item.stepFailure) ? item.stepFailure : -1;
  return {
    journey: EVAL_JOURNEY,
    viewport,
    apiOnly: false,
    steps: plan.actions.map((action, index) => (index === failedStep ? { action, ok: false, error: "step was not actionable" } : { action, ok: true, error: "" })),
    expects: plan.expect.map((expect) => ({ expect, ok: visible, error: visible ? "" : "text not visible" })),
    navigations,
    offOrigin: [],
    judged: visible ? "PASS" : "",
  };
}

function evidenceFor(item, plan, shown) {
  const runs = EVAL_VIEWPORTS.map((viewport) => evalRun(item, plan, viewport, shown));
  return { ...EVAL_BINDING, journeys: runs, steps: runs[0].steps, expects: runs[0].expects, navigations, offOrigin: [] };
}

export function evalEvidence(item, plan = item.plan) {
  return evidenceFor(item, plan, item.pageShows ?? item.pageShowsField);
}

export function answerFor(mode, item) {
  const plan = JSON.stringify(item.plan);
  if (mode === "correct") return { plan, judge: JSON.stringify({ verdict: "PASS", notes: item.why }) };
  if (mode === "blind") return { plan, judge: '{"verdict":"FAIL","notes":"Not sure."}' };
  throw new Error(`unknown replay mode ${mode}`);
}

export function ladderReady() {
  return Boolean(process.env.LADDER_CALL_BIN || process.env.LADDER_CALL_ROOT || process.env.AI_GATEWAY_API_KEY || process.env.OPENCODE_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENROUTER_API_KEY);
}

export async function judgeCase({ item, model, answer, complete = completeWithOpenRouter }) {
  const live = answer === undefined;
  let parsed = item.plan;
  let failure = "";
  try {
    const planText = live ? await complete(planPromptFor(item), { model }) : answer.plan;
    parsed = { ...parsed, ...parsePlan(planText) };
    if (!parsed.actions.length) throw new Error("the plan stage returned no actions");
    if (!planCoversFixture(parsed)) throw new Error("the plan does not exercise the fixture behaviour");
  } catch (error) { failure = redact(error?.message ?? String(error), []); }
  let result = { verdict: "FAIL", notes: failure };
  if (!failure) {
    const judgement = answer ? answer.judge : undefined;
    const ask = live ? async (prompt, options) => parseAnswer(await complete(prompt, options)) : async () => parseAnswer(judgement);
    result = await judgeJourneys({ plan: evalPlan(item, model, parsed), evidence: evalEvidence(item, parsed), picked: { model }, ask, work: "" });
  }
  return { case: item.name, model, expected: item.expected, verdict: result.verdict, notes: result.notes, ok: !failure && matches(item, result.verdict), failure, why: item.why };
}

export async function runEval({ alt, replay, complete = completeWithOpenRouter, cases = CASES }) {
  const models = evalModels(alt);
  const results = [];
  for (const model of models) {
    for (const item of cases) {
      results.push(await judgeCase({ item, model, answer: replay ? answerFor(replay, item) : undefined, complete }));
    }
  }
  return { ok: results.every((result) => result.ok), models, results };
}

function report(result, out) {
  const lines = result.results.map((row) => `${row.ok ? "ok  " : "FAIL"} ${row.case} on ${row.model}: expected ${row.expected}, got ${row.verdict}${row.failure ? ` (eval error: ${row.failure})` : ""}`);
  const body = { ok: result.ok, models: result.models, results: result.results };
  if (out) writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`);
  return `${lines.join("\n")}\n${result.ok ? "eval passed" : "eval failed"}\n`;
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const mode = argv.includes("--live") ? "live" : argv.includes("--replay") ? "replay" : "";
  const replay = argv[argv.indexOf("--replay") + 1];
  const outIndex = argv.indexOf("--out");
  const out = outIndex >= 0 ? path.resolve(argv[outIndex + 1]) : "";
  if (!mode) throw new Error("usage: pstack-verifier-eval.mjs --live | --replay correct|blind [--out file]");
  const alt = io.alt ?? process.env.PSTACK_VERIFIER_ALT_MODEL;
  if (!alt) throw new Error("PSTACK_VERIFIER_ALT_MODEL is missing");
  if (mode === "replay") {
    const result = await runEval({ alt, replay });
    const text = report(result, out);
    (io.write ?? process.stdout.write.bind(process.stdout))(text);
    return result.ok;
  }
  if (!ladderReady()) throw new Error("token ladder is not configured");
  const result = await runEval({ alt, complete: io.complete ?? completeWithOpenRouter });
  const text = report(result, out);
  (io.write ?? process.stdout.write.bind(process.stdout))(text);
  return result.ok;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((ok) => { process.exitCode = ok ? 0 : 1; }).catch((error) => { console.error(String(error?.message ?? error)); process.exitCode = 1; });
}
