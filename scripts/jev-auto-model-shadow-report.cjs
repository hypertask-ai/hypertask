#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIN_ROWS = 1000;
const MIN_PARSED = 0.95;
const MIN_DISAGREEMENT = 0.1;
const CONFIDENT = 0.8;
const RETRY_SHARE = 0.6;
const COMPARISONS = ["agree", "jev-higher", "jev-lower"];
const LEVEL_TIER = { light: 1, standard: 2, high: 3 };

const pct = (value) => (typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "n/a");
const share = (part, whole) => (whole ? part / whole : null);
const stamp = (value) => (value instanceof Date ? value.toISOString() : String(value ?? ""));

function comparisonOf(row) {
  const tier = row.jevTier ?? LEVEL_TIER[row.jevLevel] ?? null;
  if (tier === null || typeof row.autoTier !== "number") return null;
  return tier > row.autoTier ? "jev-higher" : tier < row.autoTier ? "jev-lower" : "agree";
}

function markRetries(rows) {
  const ordered = [...rows].sort((left, right) => {
    const session = String(left.chatSessionId ?? "").localeCompare(String(right.chatSessionId ?? ""));
    return session !== 0 ? session : stamp(left.createdAt).localeCompare(stamp(right.createdAt));
  });
  return ordered.map((row, index) => {
    const next = ordered[index + 1];
    return { ...row, retried: Boolean(row.chatSessionId && next && next.chatSessionId === row.chatSessionId && next.resent) };
  });
}

function analyze(inputRows) {
  const rows = markRetries(inputRows);
  const answered = rows.filter((row) => comparisonOf(row) !== null);
  const tally = (subset) => Object.fromEntries(COMPARISONS.map((name) => [name, subset.filter((row) => comparisonOf(row) === name).length]));
  const counts = tally(answered);
  const confident = answered.filter((row) => typeof row.jevConfidence === "number" && row.jevConfidence >= CONFIDENT);
  const retried = answered.filter((row) => row.retried);
  const retriedCounts = tally(retried);
  const latencies = answered.map((row) => row.jevLatencyMs).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const bars = [
    { name: "1000 Auto turns logged", pass: rows.length >= MIN_ROWS, detail: `${rows.length} of ${MIN_ROWS} turns` },
    { name: "Jev answers almost every turn", pass: (share(answered.length, rows.length) ?? 0) >= MIN_PARSED, detail: `${pct(share(answered.length, rows.length))} parsed` },
    {
      name: "Jev would change Auto's level often enough to matter",
      pass: (share(answered.length - counts.agree, answered.length) ?? 0) >= MIN_DISAGREEMENT,
      detail: `${pct(share(answered.length - counts.agree, answered.length))} disagree (${counts["jev-higher"]} higher, ${counts["jev-lower"]} lower)`,
    },
    {
      name: "On retried turns Jev mostly wanted more",
      pass: retried.length >= 20 && (share(retriedCounts["jev-higher"], retried.length) ?? 0) >= RETRY_SHARE && retriedCounts["jev-higher"] > retriedCounts["jev-lower"],
      detail: `${retried.length} retried turns, ${retriedCounts["jev-higher"]} higher, ${retriedCounts["jev-lower"]} lower, ${retriedCounts.agree} agree`,
    },
  ];
  return {
    rows: rows.length,
    answered: answered.length,
    parsed: share(answered.length, rows.length),
    counts,
    confident: `${pct(share(confident.filter((row) => comparisonOf(row) === "agree").length, confident.length))} over ${confident.length} turns`,
    retried: { count: retried.length, counts: retriedCounts },
    latencyMs: { p50: latencies[Math.ceil(latencies.length / 2) - 1] ?? null, p90: latencies[Math.ceil(latencies.length * 0.9) - 1] ?? null },
    errors: rows.filter((row) => row.error).length,
    bars,
    verdict: bars.every((bar) => bar.pass) ? "KEEP" : "DROP",
  };
}

function renderReport(result) {
  return [
    "# Auto model pilot: Jev's shadow level (HTPR-9048)",
    "",
    `${result.rows} Auto chat turns logged, ${result.answered} with a Jev level. Jev guessed the level only; Auto's own pick answered every turn.`,
    "",
    `- Jev agrees with Auto: ${pct(share(result.counts.agree, result.answered))}`,
    `- Jev wanted higher: ${result.counts["jev-higher"]}, lower: ${result.counts["jev-lower"]}`,
    `- agreement when sure (>= ${CONFIDENT}): ${result.confident}`,
    `- retried turns: ${result.retried.count} (${result.retried.counts["jev-higher"]} higher, ${result.retried.counts["jev-lower"]} lower, ${result.retried.counts.agree} agree)`,
    `- Jev latency p50 / p90: ${result.latencyMs.p50 ?? "n/a"} / ${result.latencyMs.p90 ?? "n/a"} ms, no answer on ${result.errors} turns`,
    "",
    "## Verdict",
    ...result.bars.map((bar) => `- ${bar.pass ? "PASS" : "FAIL"} ${bar.name}: ${bar.detail}`),
    "",
    result.verdict === "KEEP" ? "Keep Jev: it changes Auto's level often enough and the retries point the same way." : "Drop Jev for Auto: it does not clear every bar above, so it is not a better chooser than today's rule.",
    "",
  ].join("\n");
}

async function rowsFromDatabase(since, limit) {
  const { Pool } = require("pg");
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "Set DATABASE_URL or pass --rows=<file>");
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const { rows } = await pool.query(
      `SELECT "createdAt", "chatSessionId", "autoTier", "jevLevel", "jevTier", "jevConfidence", "jevLatencyMs", "resent", "error" FROM "AutoModelShadow" ${since ? `WHERE "createdAt" >= $1` : ""} ORDER BY "createdAt" ASC LIMIT ${Number(limit) || MIN_ROWS}`,
      since ? [since] : [],
    );
    return rows.map((row) => ({ ...row, createdAt: stamp(row.createdAt) }));
  } finally {
    await pool.end();
  }
}

async function main() {
  const arg = (name, fallback) => {
    const found = process.argv.find((value) => value.startsWith(`--${name}=`));
    return found ? found.split("=")[1] : fallback;
  };
  const rows = arg("rows") ? JSON.parse(fs.readFileSync(path.resolve(arg("rows")), "utf8")) : await rowsFromDatabase(arg("since"), arg("limit", MIN_ROWS));
  assert.ok(Array.isArray(rows), "rows must be a JSON array");
  const result = analyze(rows);
  const out = path.resolve(arg("out", path.join(process.cwd(), "auto-model-shadow-out")));
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "scores.json"), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(out, "report.md"), `${renderReport(result)}\n`);
  console.log(renderReport(result));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { MIN_ROWS, CONFIDENT, analyze, renderReport, markRetries, comparisonOf };
