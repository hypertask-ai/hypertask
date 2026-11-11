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
const stamp = (value) => (value instanceof Date ? value.toISOString() : String(value ?? ""));
const tierOf = (row) => (row.jevTier ?? LEVEL_TIER[row.jevLevel] ?? null);
const comparisonOf = (row) => {
  const tier = tierOf(row);
  if (tier === null || typeof row.autoTier !== "number") return null;
  if (tier > row.autoTier) return "jev-higher";
  if (tier < row.autoTier) return "jev-lower";
  return "agree";
};

function percentile(values, fraction) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
}

function orderRows(rows) {
  return [...rows].sort((left, right) => {
    const session = String(left.chatSessionId ?? "").localeCompare(String(right.chatSessionId ?? ""));
    return session !== 0 ? session : stamp(left.createdAt).localeCompare(stamp(right.createdAt));
  });
}

function markRetries(rows) {
  const ordered = orderRows(rows);
  return ordered.map((row, index) => {
    const next = ordered[index + 1];
    const retried = Boolean(row.chatSessionId && next && next.chatSessionId === row.chatSessionId && next.resent);
    return { ...row, retried };
  });
}

function share(part, whole) {
  return whole ? part / whole : null;
}

function analyze(inputRows) {
  const rows = markRetries(inputRows);
  const answered = rows.filter((row) => comparisonOf(row) !== null);
  const counts = Object.fromEntries(COMPARISONS.map((name) => [name, answered.filter((row) => comparisonOf(row) === name).length]));
  const confident = answered.filter((row) => typeof row.jevConfidence === "number" && row.jevConfidence >= CONFIDENT);
  const retried = answered.filter((row) => row.retried);
  const retriedCounts = Object.fromEntries(COMPARISONS.map((name) => [name, retried.filter((row) => comparisonOf(row) === name).length]));
  const features = [...new Set(rows.map((row) => row.feature ?? "chat"))].sort();
  const byFeature = features.map((feature) => {
    const own = answered.filter((row) => (row.feature ?? "chat") === feature);
    return {
      feature,
      rows: rows.filter((row) => (row.feature ?? "chat") === feature).length,
      answered: own.length,
      agreement: share(own.filter((row) => comparisonOf(row) === "agree").length, own.length),
      higher: own.filter((row) => comparisonOf(row) === "jev-higher").length,
      lower: own.filter((row) => comparisonOf(row) === "jev-lower").length,
      retried: own.filter((row) => row.retried).length,
    };
  });
  const latencies = answered.map((row) => row.jevLatencyMs);
  const retriedHigherShare = share(retriedCounts["jev-higher"], retried.length);
  const bars = [
    {
      name: "1000 Auto turns logged",
      pass: rows.length >= MIN_ROWS,
      detail: `${rows.length} of ${MIN_ROWS} turns`,
    },
    {
      name: "Jev answers almost every turn",
      pass: share(answered.length, rows.length) !== null && share(answered.length, rows.length) >= MIN_PARSED,
      detail: `${pct(share(answered.length, rows.length))} parsed (${answered.length} of ${rows.length})`,
    },
    {
      name: "Jev would change Auto's level often enough to matter",
      pass: share(answered.length - counts.agree, answered.length) !== null && share(answered.length - counts.agree, answered.length) >= MIN_DISAGREEMENT,
      detail: `${pct(share(answered.length - counts.agree, answered.length))} disagree (${counts["jev-higher"]} higher, ${counts["jev-lower"]} lower)`,
    },
    {
      name: "On retried turns Jev mostly wanted more",
      pass: retried.length >= 20 && retriedHigherShare !== null && retriedHigherShare >= RETRY_SHARE && retriedCounts["jev-higher"] > retriedCounts["jev-lower"],
      detail: `${retried.length} retried turns, ${retriedCounts["jev-higher"]} higher, ${retriedCounts["jev-lower"]} lower, ${retriedCounts.agree} agree`,
    },
  ];
  return {
    rows: rows.length,
    answered: answered.length,
    parsed: share(answered.length, rows.length),
    agreement: share(counts.agree, answered.length),
    counts,
    confident: {
      threshold: CONFIDENT,
      count: confident.length,
      coverage: share(confident.length, answered.length),
      agreement: share(confident.filter((row) => comparisonOf(row) === "agree").length, confident.length),
    },
    retried: { count: retried.length, counts: retriedCounts },
    byFeature,
    latencyMs: { p50: percentile(latencies, 0.5), p90: percentile(latencies, 0.9) },
    errors: rows.filter((row) => row.error).length,
    bars,
    verdict: bars.every((bar) => bar.pass) ? "KEEP" : "DROP",
  };
}

function renderReport(result) {
  const row = (name, value) => `| ${name} | ${value} |`;
  return [
    "# Auto model pilot: Jev's shadow level (HTPR-9048)",
    "",
    `${result.rows} Auto chat turns logged, ${result.answered} with a Jev level, ${result.confident.count} at ${CONFIDENT} confidence or higher.`,
    "Jev guessed the effort level only. Auto's own pick served every turn, so nothing changed for the person.",
    "",
    "| metric | value |",
    "|---|---|",
    row("turns logged", String(result.rows)),
    row("Jev answered", `${result.answered} (${pct(result.parsed)})`),
    row("Jev agrees with Auto", pct(result.agreement)),
    row("Jev wanted a higher level", `${result.counts["jev-higher"]} (${pct(share(result.counts["jev-higher"], result.answered))})`),
    row("Jev wanted a lower level", `${result.counts["jev-lower"]} (${pct(share(result.counts["jev-lower"], result.answered))})`),
    row(`agreement when sure (>= ${CONFIDENT})`, `${pct(result.confident.agreement)} (${result.confident.count} turns, ${pct(result.confident.coverage)} coverage)`),
    row("turns the person retried", `${result.retried.count}: ${result.retried.counts["jev-higher"]} Jev wanted higher, ${result.retried.counts["jev-lower"]} lower, ${result.retried.counts.agree} agree`),
    row("Jev latency p50 / p90", `${result.latencyMs.p50 ?? "n/a"} / ${result.latencyMs.p90 ?? "n/a"} ms`),
    row("turns with no Jev answer", String(result.errors)),
    "",
    "## By feature",
    "| feature | turns | answered | agree | higher | lower | retried |",
    "|---|---|---|---|---|---|---|",
    ...result.byFeature.map((entry) => `| ${entry.feature} | ${entry.rows} | ${entry.answered} | ${pct(entry.agreement)} | ${entry.higher} | ${entry.lower} | ${entry.retried} |`),
    "",
    "## Verdict",
    ...result.bars.map((bar) => `- ${bar.pass ? "PASS" : "FAIL"} ${bar.name}: ${bar.detail}`),
    "",
    result.verdict === "KEEP"
      ? "Keep Jev: it would change Auto's level often enough and the retries point the same way. Next step is a test on our own team only."
      : "Drop Jev for Auto: it does not clear every bar above, so it is not a better chooser than today's rule.",
    "",
  ].join("\n");
}

async function rowsFromDatabase({ since, limit }) {
  const { Pool } = require("pg");
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "Set DATABASE_URL or pass --rows=<file>");
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const where = since ? `WHERE "createdAt" >= $1` : "";
    const order = `ORDER BY "createdAt" ASC LIMIT ${Number(limit) || MIN_ROWS}`;
    const { rows } = await pool.query(
      `SELECT "id", "createdAt", "userId", "teamId", "projectId", "chatSessionId", "feature", "autoTier", "autoStepUp", "autoModelKey", "jevLevel", "jevTier", "jevConfidence", "jevLatencyMs", "longThread", "resent", "codeFence", "comparison", "error" FROM "AutoModelShadow" ${where} ${order}`,
      since ? [since] : [],
    );
    return rows.map((row) => ({ ...row, id: String(row.id), createdAt: stamp(row.createdAt) }));
  } finally {
    await pool.end();
  }
}

async function main() {
  const arg = (name, fallback) => {
    const found = process.argv.find((value) => value.startsWith(`--${name}=`));
    return found ? found.split("=")[1] : fallback;
  };
  const rows = arg("rows")
    ? JSON.parse(fs.readFileSync(path.resolve(arg("rows")), "utf8"))
    : await rowsFromDatabase({ since: arg("since"), limit: arg("limit", MIN_ROWS) });
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

module.exports = { MIN_ROWS, MIN_PARSED, MIN_DISAGREEMENT, CONFIDENT, RETRY_SHARE, analyze, renderReport, markRetries, comparisonOf, percentile };
