#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { runEval, writeReport } = require("./lib/run.cjs");

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function argValue(flag, fallback) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  return args[index + 1] || fallback;
}

const mode = argValue("--mode", "fixture");
const label = argValue("--label", "pre-6478");
const dest = path.resolve(
  argValue(
    "--out",
    path.join(here, "..", "..", "src", "lib", "mcpClientEval", "latest.json"),
  ),
);
const baselineDest = path.resolve(
  argValue("--baseline-out", path.join(here, "baselines", "pre-6478.json")),
);

const report = await runEval({
  mode,
  label,
  baseline: label,
  recordTranscripts: args.includes("--write-transcripts"),
  requireClients: argValue("--require-clients", process.env.EVAL_REQUIRE_CLIENTS || ""),
  surfaces: mode !== "replay",
});

writeReport(report, dest);
if (args.includes("--write-baseline")) {
  writeReport(report, baselineDest);
}

const { summary } = report;
const rate =
  summary.successRate == null ? "no client rows" : `${(summary.successRate * 100).toFixed(1)}%`;
process.stdout.write(
  `${report.rows.length} rows · ${summary.passed}/${summary.tasks} passed · ${rate} · surfaces ${summary.surfaceFailed || 0} failed\n`,
);

if (summary.failed > 0 || (summary.surfaceFailed || 0) > 0) process.exit(1);
