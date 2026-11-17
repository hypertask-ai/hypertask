import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FLASH, buildPrompt, completeWithOpenRouter, decide, parseAnswer, pickVerifier, redact } from "./pstack-verifier.mjs";

export { FLASH };
export const EVAL_BINDING = { sha: "b".repeat(40), run: "1", attempt: "1" };
export const EVAL_REPO_FILES = ["src/app/project/field-list.tsx"];

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

const steps = actions.map((action) => ({ action, ok: true, error: "" }));
const navigations = [{ url: "http://127.0.0.1:3100/project?id=1", status: 200 }];

export const CASES = [
  {
    name: "planted-bug",
    expected: "FAIL",
    why: "The saved field name is not on the page, so the claimed behaviour is broken.",
    claim,
    plan: { actions, expect: [{ text: "Renewal date" }] },
    evidence: { steps, expects: [{ expect: { text: "Renewal date" }, ok: false, error: "text not visible" }], navigations, offOrigin: [] },
  },
  {
    name: "clean",
    expected: "PASS",
    why: "The saved field name is on the page, so the claimed behaviour works.",
    claim,
    plan: { actions, expect: [{ text: "Renewal date" }] },
    evidence: { steps, expects: [{ expect: { text: "Renewal date" }, ok: true, error: "" }], navigations, offOrigin: [] },
  },
];

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

export function evalPlan(item, model) {
  return { ...EVAL_BINDING, authorFamily: String(model).startsWith("deepseek/") ? "deepseek" : "other", verifierModel: model, actions: item.plan.actions, expect: item.plan.expect, reason: "" };
}

export function evalEvidence(item) {
  return { ...EVAL_BINDING, ...item.evidence };
}

export async function judgeCase({ item, model, key, answer, complete = completeWithOpenRouter }) {
  const plan = evalPlan(item, model);
  const evidence = evalEvidence(item);
  let reply = answer;
  let failure = "";
  if (reply === undefined) {
    try { reply = await complete(promptFor(item, plan, evidence), { key, model }); }
    catch (error) { failure = redact(error?.message ?? String(error), [key]); }
  }
  let judged = { verdict: "", notes: "" };
  if (reply !== undefined) {
    try { judged = parseAnswer(reply); }
    catch (error) { failure = redact(error?.message ?? String(error), [key]); }
  }
  const result = decide({ model: failure ? { verdict: "FAIL", notes: failure } : judged, plan, evidence, binding: EVAL_BINDING });
  return { case: item.name, model, expected: item.expected, verdict: result.verdict, notes: result.notes, ok: matches(item, result.verdict), why: item.why };
}

export async function runEval({ alt, key, answers, complete = completeWithOpenRouter, cases = CASES }) {
  const models = evalModels(alt);
  const results = [];
  for (const model of models) {
    for (const item of cases) {
      results.push(await judgeCase({ item, model, key, answer: answers?.[item.name], complete }));
    }
  }
  return { ok: results.every((result) => result.ok), models, results };
}

export function answersFor(mode) {
  if (mode === "correct") return { "planted-bug": '{"verdict":"FAIL","notes":"The saved field is not on the page."}', clean: '{"verdict":"PASS","notes":"The saved field is visible."}' };
  if (mode === "blind") return { "planted-bug": '{"verdict":"FAIL","notes":"Not sure."}', clean: '{"verdict":"FAIL","notes":"Not sure."}' };
  throw new Error(`unknown replay mode ${mode}`);
}

function report(result, out) {
  const lines = result.results.map((row) => `${row.ok ? "ok  " : "FAIL"} ${row.case} on ${row.model}: expected ${row.expected}, got ${row.verdict}`);
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
  const key = io.key ?? process.env.OPENROUTER_EVAL_KEY;
  if (!alt) throw new Error("PSTACK_VERIFIER_ALT_MODEL is missing");
  if (mode === "replay") {
    const result = await runEval({ alt, answers: answersFor(replay) });
    const text = report(result, out);
    (io.write ?? process.stdout.write.bind(process.stdout))(text);
    return result.ok;
  }
  if (!key) throw new Error("OPENROUTER_EVAL_KEY is missing");
  const result = await runEval({ alt, key });
  const text = report(result, out);
  (io.write ?? process.stdout.write.bind(process.stdout))(text);
  return result.ok;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((ok) => { process.exitCode = ok ? 0 : 1; }).catch((error) => { console.error(String(error?.message ?? error)); process.exitCode = 1; });
}
