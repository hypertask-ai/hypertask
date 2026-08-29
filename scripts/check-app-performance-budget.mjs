#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(
  root,
  "config/app-project-performance-baseline.json",
);
const tracePath = process.argv[2];

if (!tracePath) {
  console.error(
    "Usage: npm run performance:budget -- <mobile-or-desktop-trace.json>",
  );
  process.exit(2);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const trace = JSON.parse(fs.readFileSync(path.resolve(tracePath), "utf8"));
const deviceClass = trace.deviceClass;
const expected = baseline.devices[deviceClass];

if (!expected) {
  console.error('Trace must set deviceClass to "mobile" or "desktop".');
  process.exit(2);
}

const metricNames = [
  "scriptCount",
  "scriptDecodedBytes",
  "apiRequestCount",
  "apiDecodedBytes",
];
const rows = metricNames.map((metric) => {
  const actual = trace[metric];
  const reference = Number(expected[metric]);
  if (
    typeof actual !== "number" ||
    !Number.isFinite(actual) ||
    actual < 0
  ) {
    throw new Error(`Trace ${metric} must be a finite, non-negative number.`);
  }
  const changePercent = ((actual - reference) / reference) * 100;
  return {
    metric,
    baseline: reference,
    actual,
    changePercent: Number(changePercent.toFixed(2)),
    status:
      changePercent > baseline.regressionPercent ? "regression" : "pass",
  };
});

console.table(rows);
if (rows.some((row) => row.status === "regression")) process.exit(1);
