#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const BOARD = 15;
const CUTOFF = "2026-10-01T00:00:00Z";
const BUDGET = 4000;
const JEV = "typesafe/jev-1.14";
const WRITER = "claude-haiku-5-5";
const KEEP = 0.8;
const SWEEP = [0.5, 0.6, 0.7, 0.8, 0.9];
const DIR = path.resolve(__dirname, "../tests/fixtures/task-writer-label-eval");
const CORPUS = path.join(DIR, "corpus.json");
const SCORES = path.join(DIR, "scores.json");
const REPORT = path.join(DIR, "report.md");
const BRIEF = "You tag one software ticket with labels from a board's label list. Choose every label whose meaning fits this ticket and no others. Answer with a JSON array of label names copied exactly from the list. Answer [] when none fit.";
const BOOKKEEPING = [/^brain-/, /^flag:/, /^llm:/, /^intensity:/, /^announced-/, /^my-tasks/, /^qa-/, /^__probe/, /^P[123]$/,
  /^(tes|sol|stale|urgent|planner|reports|incident|initiative|easy|hard|api|e2b)$/,
  /^(needs-human|needs-info|auto-error|prod-error|verify-fleet|wayfinder|agent-fleet|ai-feedback|skills-pilot|user-feedback|anthropic-standards|linear-features|design-pass|ux-affected|cli-mcp-ai)$/];
const CLIENT = [/\binne\b/gi, /\bwazig\b/gi, /\bfuneral\b/gi, /\b1st ?formations?\b/gi, /\bfirst formations?\b/gi];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const question = (name) => `Should this ticket carry the label "${name}"?`;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const pct = (value) => (typeof value === "number" && !Number.isNaN(value) ? `${(value * 100).toFixed(1)}%` : "-");
const isBookkeeping = (name) => BOOKKEEPING.some((pattern) => pattern.test(name));
const writeFile = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };

function loadCorpus(file = CORPUS) {
  const raw = fs.readFileSync(file, "utf8");
  const corpus = JSON.parse(raw);
  assert.ok(!CLIENT.some((pattern) => new RegExp(pattern.source, "i").test(raw)), "corpus carries client text");
  assert.ok(!EMAIL.test(raw), "corpus carries an email address");
  assert.ok(corpus.cases.every((testCase) => !("labels" in testCase) && !("description" in testCase)), "corpus carries a raw ticket");
  assert.ok(corpus.labels.every((label) => !isBookkeeping(label.name)), "corpus labels carry bookkeeping labels");
  assert.equal(corpus.boardId, BOARD, "the corpus must come from board 15");
  assert.ok(corpus.cases.length >= 150, "need at least 150 labelled tickets");
  assert.ok(corpus.labels.length >= 50 && corpus.boardLabels.length >= 100, "need the board's labels");
  assert.equal(new Set(corpus.cases.map((testCase) => testCase.id)).size, corpus.cases.length, "duplicate ticket in corpus");
  for (const testCase of corpus.cases) {
    assert.ok(testCase.gold.length && testCase.title.trim() && testCase.text.trim(), `${testCase.id}: empty ticket`);
    assert.ok(testCase.gold.every((name) => corpus.labels.some((label) => label.name === name)), `${testCase.id}: gold outside the writer labels`);
  }
  return corpus;
}

function verifyCorpus(file = CORPUS) {
  const corpus = loadCorpus(file);
  console.log(`corpus verified: ${corpus.cases.length} cases, ${corpus.labels.length} writer labels, sha256 ${sha(JSON.stringify(corpus.cases)).slice(0, 12)}`);
}

function jevRequest(testCase, names) {
  const questions = {};
  names.forEach((name, index) => { questions[`label_${index}`] = { type: "noul", instructions: question(name) }; });
  return { model: JEV, session_id: "htpr-9047-label-eval", provider: { zdr: true, only: ["typesafe"], data_collection: "deny" }, state: { title: testCase.title, text: testCase.text }, questions };
}

function parseJevAnswers(body, names) {
  const probabilities = {};
  names.forEach((name, index) => {
    const answer = body?.answers?.[`label_${index}`];
    if (answer?.type === "noul" && typeof answer.noul === "number") probabilities[name] = Math.round(Math.min(1, Math.max(0, answer.noul)) * 1000) / 1000;
  });
  return Object.keys(probabilities).length ? { probabilities } : { probabilities, error: String(body?.error?.message ?? "no noul answers").slice(0, 200) };
}

function keepSureLabels(probabilities, threshold = KEEP) {
  return Object.entries(probabilities ?? {}).filter(([, value]) => value >= threshold).map(([name]) => name).sort();
}

const serialised = (labels) => JSON.stringify(labels.map((label) => ({ id: label.id, name: label.name })));

function writerVocabulary(labels, budget = BUDGET) {
  const visible = [];
  for (const label of labels) {
    if (`labels:${serialised([...visible, label])}`.length > budget) break;
    visible.push(label);
  }
  return visible;
}

function writerPrompt(testCase, labels) {
  return { instructions: BRIEF, input: `LABELS\n${JSON.stringify(labels.map((label) => label.name))}\n\nTICKET\nTitle: ${testCase.title}\n\n${testCase.text}` };
}

const normalise = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function parseLabelAnswer(text, names) {
  const body = String(text ?? "");
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  let wanted = null;
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(body.slice(start, end + 1));
      if (Array.isArray(parsed)) wanted = parsed.map((value) => String(value));
    } catch {
      wanted = null;
    }
  }
  if (wanted === null) wanted = body.split(/[\n,]/).map((value) => value.replace(/^[-*\d.\s]+/, "").trim());
  const known = new Map(names.map((name) => [normalise(name), name]));
  return [...new Set(wanted.map((value) => known.get(normalise(value))).filter(Boolean))].sort();
}

function percentile(values, fraction) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))] : null;
}

function scoreArm(rows) {
  const answered = rows.filter((row) => !row.error);
  const totals = { tp: 0, fp: 0, fn: 0, picked: 0, exact: 0, silent: 0, costUsd: 0 };
  for (const row of answered) {
    const gold = new Set(row.gold);
    const hits = row.predicted.filter((name) => gold.has(name)).length;
    const precision = row.predicted.length ? hits / row.predicted.length : null;
    const recall = gold.size ? hits / gold.size : null;
    totals.tp += hits;
    totals.fp += row.predicted.length - hits;
    totals.fn += gold.size - hits;
    totals.picked += row.predicted.length;
    totals.costUsd += row.costUsd ?? 0;
    if (!row.predicted.length) totals.silent++;
    if (row.predicted.length === gold.size && hits === gold.size) totals.exact++;
  }
  const precision = totals.tp + totals.fp ? totals.tp / (totals.tp + totals.fp) : null;
  const recall = totals.tp + totals.fn ? totals.tp / (totals.tp + totals.fn) : null;
  return {
    ...totals, cases: rows.length, errors: rows.length - answered.length, answered: answered.length, precision, recall,
    f1: precision !== null && recall !== null && precision + recall ? (2 * precision * recall) / (precision + recall) : null,
    latency: { p50: percentile(rows.map((row) => row.latencyMs), 0.5) },
  };
}

function sweep(jevRows, thresholds = SWEEP) {
  return thresholds.map((threshold) => {
    const scored = scoreArm(jevRows.map((row) => (row.error ? row : { ...row, predicted: keepSureLabels(row.probabilities, threshold) })));
    return [pct(threshold), pct(scored.recall), pct(scored.precision), pct(scored.f1), scored.picked, scored.silent];
  });
}

function visibleCeiling(cases, boardLabels) {
  const visible = new Set(writerVocabulary(boardLabels).map((label) => label.name));
  const gold = cases.flatMap((testCase) => testCase.gold);
  const covered = gold.filter((name) => visible.has(name)).length;
  return { labels: boardLabels.length, visible: visible.size, hidden: boardLabels.length - visible.size, gold: gold.length, covered, coveredShare: gold.length ? covered / gold.length : null };
}

function gatesFor(label, jev, today) {
  const gates = [
    { name: "finds more of the labels on the ticket", pass: jev.recall > today.recall, detail: `recall ${pct(jev.recall)} against ${pct(today.recall)}` },
    { name: "adds no more wrong labels", pass: jev.precision >= today.precision, detail: `precision ${pct(jev.precision)} against ${pct(today.precision)}` },
    { name: "scores better overall", pass: jev.f1 > today.f1, detail: `F1 ${pct(jev.f1)} against ${pct(today.f1)}` },
    { name: "answers nearly every ticket", pass: jev.errors / jev.cases <= 0.02, detail: `${jev.errors} of ${jev.cases} failed` },
    { name: "is not slower than today", pass: jev.latency.p50 <= today.latency.p50, detail: `p50 ${jev.latency.p50}ms against ${today.latency.p50}ms` },
  ];
  return { label, gates, keep: gates.every((gate) => gate.pass) };
}

function verdict(variants, today) {
  const judged = variants.map((variant) => ({ ...gatesFor(variant.label, variant.arm, today), arm: variant.arm }));
  const winner = judged.filter((entry) => entry.keep).sort((a, b) => b.arm.f1 - a.arm.f1)[0] ?? null;
  return { variants: judged, gates: (winner ?? judged[0]).gates, judged: winner?.label ?? null, keep: Boolean(winner), answer: winner ? `KEEP Jev, asking only about ${winner.label}` : "DROP Jev" };
}

function assemble(corpus, startedAt, rows, threshold = KEEP) {
  const jev = scoreArm(rows.jev);
  const jevWriter = scoreArm(rows.jevWriter);
  return {
    ticket: "HTPR-9047", startedAt, threshold,
    models: { jev: JEV, today: WRITER, question: question("x"), brief: BRIEF, budget: BUDGET },
    corpus: { cases: corpus.cases.length, labels: corpus.labels.length, boardLabels: corpus.boardLabels.length, boardId: corpus.boardId, cutoff: corpus.cutoff, sha256: sha(JSON.stringify(corpus.cases)) },
    jev, jevWriter, today: scoreArm(rows.todayCapped), full: scoreArm(rows.todayFull),
    ceiling: visibleCeiling(corpus.cases, corpus.boardLabels),
    sweep: sweep(rows.jev),
    verdict: verdict([{ label: "the whole board label list", arm: jev }, { label: "only the labels a writer sets", arm: jevWriter }], scoreArm(rows.todayCapped)),
    rows,
  };
}

const table = (head, rows) => [head, head.map(() => "---"), ...rows].map((cells) => `| ${cells.join(" | ")} |`).join("\n");

function renderReport(result) {
  const { jev, jevWriter, today, full, ceiling, verdict: outcome } = result;
  const metrics = [
    ["tickets answered", (arm) => `${arm.answered} of ${arm.cases}`],
    ["recall (micro)", (arm) => pct(arm.recall)],
    ["precision (micro)", (arm) => pct(arm.precision)],
    ["F1 (micro)", (arm) => pct(arm.f1)],
    ["labels right / picked", (arm) => `${arm.tp} / ${arm.picked}`],
    ["wrong labels added", (arm) => String(arm.fp)],
    ["tickets left with no label", (arm) => String(arm.silent)],
    ["latency p50", (arm) => `${arm.latency.p50}ms`],
    ["cost for the run", (arm) => `$${arm.costUsd.toFixed(4)}`],
    ["errors", (arm) => String(arm.errors)],
  ];
  return [
    "# Board label pilot: Jev against today's writer (HTPR-9047)",
    "",
    `Jev ${JEV} answers one yes-or-no question per label in a single call, and we keep the labels it is at least ${pct(result.threshold)} sure of. Today's writer ${WRITER} answers one prompt with the board label list cut to the ${BUDGET}-character vocabulary budget. One more arm asks today's writer with the whole list, so the cut and the model stay apart.`,
    "",
    `Corpus: ${result.corpus.cases} board ${result.corpus.boardId} tickets created before ${String(result.corpus.cutoff).slice(0, 10)}, their labels hidden from every arm; ${ceiling.labels} board labels, of which ${result.corpus.labels} are labels a writer sets and ${ceiling.visible} fit in today's list.`,
    "",
    "## Result",
    "",
    table(["metric", "Jev, whole label list", "Jev, writer labels only", "Today, capped list", "Today, whole list"], metrics.map(([name, fn]) => [name, fn(jev), fn(jevWriter), fn(today), fn(full)])),
    "",
    `Today's writer sees ${ceiling.visible} of ${ceiling.labels} labels, so ${ceiling.hidden} are cut off (${pct(ceiling.hidden / ceiling.labels)} of the board). ${ceiling.gold - ceiling.covered} of the ${ceiling.gold} labels on these tickets (${pct(1 - ceiling.coveredShare)}) sit past the cut, where no prompt can return them.`,
    "",
    "## Confidence sweep, Jev with the whole label list",
    "",
    table(["keep at", "recall", "precision", "F1", "labels picked", "tickets left with no label"], result.sweep),
    "",
    "## Verdict",
    "",
    ...outcome.variants.flatMap((variant) => [`### Jev with ${variant.label}`, "", ...variant.gates.map((gate) => `- ${gate.pass ? "PASS" : "FAIL"} Jev ${gate.name}: ${gate.detail}`), ""]),
    outcome.keep ? `Verdict: ${outcome.answer}. Judged on ${outcome.judged}.` : `Verdict: ${outcome.answer}. No Jev setup cleared every bar.`,
    "",
    "## Method",
    "",
    "- The corpus is board 15 tickets created before the cutoff, and the labels the board already carries are the answer key. Labels stay out of every request; every arm gets the title and the first 1000 characters of the note.",
    "- Jev gets one `noul` question per label, each answer one probability, kept at 0.8 for the verdict, the confidence Fable named for the live step.",
    "- Today's arm is the writer's label decision: the label list and the ticket in one prompt, answered as label names, cut at 4000 characters the way `formatBoardVocabulary` cuts it.",
    "- The verdict asks for more right labels and no more wrong ones than today, the bar the ticket sets.",
    "",
    "## Limits",
    "",
    "- Today's arm makes the writer's decision with a plainer prompt than the shipped one, so it is a stand-in rather than the shipped draft.",
    "- A label a writer would add but nobody wanted counts as wrong, the same way a missed one does.",
    "- The capped arm spends the whole 4000 characters on labels; the shipped vocabulary spends part of it on the project title, description and columns first, so production hides at least as many labels as measured here.",
    "- The label list is alphabetical here; production order follows the database, so which labels fall past the cut can differ.",
  ].join("\n");
}

function write(out, result) {
  writeFile(path.join(out, "scores.json"), `${JSON.stringify(result)}\n`);
  const report = renderReport(result);
  writeFile(path.join(out, "report.md"), `${report}\n`);
  return report;
}

function checkBaseline() {
  const corpus = loadCorpus();
  const saved = JSON.parse(fs.readFileSync(SCORES, "utf8"));
  const result = assemble(corpus, saved.startedAt, saved.rows, saved.threshold);
  assert.equal(renderReport(result), fs.readFileSync(REPORT, "utf8").replace(/\n+$/, ""), "committed report does not match the committed scores");
  assert.equal(result.verdict.gates.length, 5, "the verdict must score five gates");
  assert.equal(typeof result.verdict.keep, "boolean", "the verdict must state a keep or a drop");
  assert.equal(result.sweep.length, SWEEP.length, "the sweep must cover every threshold");
  assert.ok(result.ceiling.coveredShare > 0 && result.ceiling.coveredShare <= 1, "the list cut must be measured");
  process.stdout.write(`verdict: ${result.verdict.answer}, recall ${pct(result.jev.recall)} against ${pct(result.today.recall)}, precision ${pct(result.jev.precision)} against ${pct(result.today.precision)}\nverdict measured\nlabel eval ok\n`);
}

async function post(url, headers, body, read, timeout) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const parsed = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${String(parsed?.error?.message ?? "").slice(0, 160)}`);
  return read(parsed);
}

async function askJev(testCase, names, key) {
  const answer = await post("https://openrouter.ai/api/alpha/decisions", { Authorization: `Bearer ${key}` }, jevRequest(testCase, names), (body) => ({ ...parseJevAnswers(body, names), costUsd: body.usage?.cost ?? 0 }), 30000);
  if (answer.error) throw new Error(answer.error);
  return { probabilities: answer.probabilities, costUsd: answer.costUsd, predicted: keepSureLabels(answer.probabilities) };
}

async function askWriter(testCase, labels, key) {
  const body = await post("https://api.anthropic.com/v1/messages", { "x-api-key": key, "anthropic-version": "2023-06-01" }, {
    model: WRITER, max_tokens: 400, thinking: { type: "adaptive" }, ...writerPrompt(testCase, labels), output_config: { effort: "medium" },
  }, (parsed) => parsed, 45000);
  const usage = body.usage ?? {};
  return {
    predicted: parseLabelAnswer((body.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join(""), labels.map((label) => label.name)),
    costUsd: (usage.input_tokens ?? 0) * 1e-6 + (usage.output_tokens ?? 0) * 5e-6,
  };
}

async function runArm(cases, work, concurrency) {
  const out = new Array(cases.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < cases.length) {
      const testCase = cases[next++];
      const started = Date.now();
      try {
        out[cases.indexOf(testCase)] = { id: testCase.id, gold: testCase.gold, latencyMs: Date.now() - started, ...(await work(testCase)) };
      } catch (error) {
        out[cases.indexOf(testCase)] = { id: testCase.id, gold: testCase.gold, predicted: [], latencyMs: null, error: String(error?.message ?? error).slice(0, 200) };
      }
    }
  }));
  return out;
}

async function main() {
  const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
  const out = path.resolve(arg("out", path.join(process.cwd(), "label-eval-out")));
  if (process.argv.includes("--verify-corpus")) return verifyCorpus(arg("file", CORPUS));
  if (process.argv.includes("--check-baseline")) return checkBaseline();
  const corpus = loadCorpus(arg("corpus", CORPUS));
  if (arg("replay")) {
    const saved = JSON.parse(fs.readFileSync(path.resolve(arg("replay")), "utf8"));
    process.stdout.write(`${write(out, assemble(corpus, saved.startedAt, saved.rows, saved.threshold))}\n`);
    return;
  }
  const cases = arg("limit") ? corpus.cases.slice(0, Number(arg("limit"))) : corpus.cases;
  const concurrency = Number(arg("concurrency", 6));
  const jevKey = process.env.OPENROUTER_EVAL_KEY;
  const writerKey = process.env.ANTHROPIC_API_KEY;
  assert.ok(jevKey, "set OPENROUTER_EVAL_KEY to the capped eval key");
  assert.ok(writerKey, "set ANTHROPIC_API_KEY to score today's arm");
  const rows = {
    jev: await runArm(cases, (testCase) => askJev(testCase, corpus.boardLabels.map((label) => label.name), jevKey), concurrency),
    jevWriter: await runArm(cases, (testCase) => askJev(testCase, corpus.labels.map((label) => label.name), jevKey), concurrency),
    todayCapped: await runArm(cases, (testCase) => askWriter(testCase, writerVocabulary(corpus.boardLabels), writerKey), concurrency),
    todayFull: await runArm(cases, (testCase) => askWriter(testCase, corpus.boardLabels, writerKey), concurrency),
  };
  const result = assemble({ ...corpus, cases }, new Date().toISOString(), rows);
  process.stdout.write(`${write(out, result)}\n`);
  assert.ok(result.jev.answered > 0 && result.today.answered > 0, "both arms must answer at least one ticket");
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = {
  assemble, checkBaseline, isBookkeeping, jevRequest, keepSureLabels, loadCorpus, normalise,
  parseJevAnswers, parseLabelAnswer, pct, percentile, renderReport, scoreArm, sweep, table, verdict,
  verifyCorpus, visibleCeiling, write, writerPrompt, writerVocabulary, JEV, WRITER, KEEP, SWEEP, BUDGET, CORPUS, SCORES, REPORT,
};
