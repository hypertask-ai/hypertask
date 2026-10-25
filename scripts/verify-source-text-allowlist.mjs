#!/usr/bin/env node
/**
 * Verifies the source-text regex test allowlist by sampling files and
 * classifying them as true or false positives.
 * 
 * A TRUE POSITIVE is a test that:
 * 1. Reads source files (not just fixtures, package.json, or test helpers)
 * 2. Applies regex operations to that source content
 * 3. Asserts based on those regex matches
 * 
 * Usage: node scripts/verify-source-text-allowlist.mjs [--sample-size N]
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectSourceTextRegex, sampleEvenly } from "./lib/source-text-regex-detector.cjs";

const args = process.argv.slice(2);
const sampleIndex = args.findIndex(arg => arg === "--sample-size" || arg.startsWith("--sample-size="));
const rawSampleSize = sampleIndex === -1 ? "15" : args[sampleIndex] === "--sample-size"
  ? args[sampleIndex + 1]
  : args[sampleIndex].slice("--sample-size=".length);
const sampleSize = Number(rawSampleSize);
if (!/^\d+$/.test(rawSampleSize ?? "") || !Number.isSafeInteger(sampleSize) || sampleSize <= 0) {
  console.error("--sample-size must be a positive integer");
  process.exit(2);
}

const root = process.cwd();
const allowlistPath = join(root, "tests/source-text-regex-allowlist.json");
const { allowlist } = JSON.parse(readFileSync(allowlistPath, "utf8"));

console.log(`Sampling ${sampleSize} files from ${allowlist.length} allowlisted tests...\n`);

const samples = sampleEvenly(allowlist, sampleSize);
const results = samples.map(testPath => {
  const { offender, matchedVariables } = detectSourceTextRegex(readFileSync(join(root, testPath), "utf8"));
  return {
    file: testPath,
    truePositive: offender,
    reason: offender ? "Reads source AND applies assert.match to it" : "No source read is regex-matched by its own binding",
    evidence: matchedVariables.length > 0 ? [`Matched variables: ${matchedVariables.join(', ')}`] : []
  };
});

console.log("| File | True Positive? | Reason | Evidence |");
console.log("|------|----------------|--------|----------|");

for (const r of results) {
  const fileName = r.file.split('/').pop();
  const evidence = r.evidence.slice(0, 1).join('; ') || 'N/A';
  console.log(`| ${fileName} | ${r.truePositive ? 'YES' : 'NO'} | ${r.reason} | ${evidence} |`);
}

const trueCount = results.filter(r => r.truePositive).length;
const falseCount = results.filter(r => !r.truePositive).length;
const percentage = count => results.length === 0 ? 0 : Math.round(count / results.length * 100);

console.log(`\n## Summary`);
console.log(`- Sampled: ${results.length} files`);
console.log(`- True positives: ${trueCount} (${percentage(trueCount)}%)`);
console.log(`- False positives: ${falseCount} (${percentage(falseCount)}%)`);
console.log(`\nTotal allowlist size: ${allowlist.length}`);

if (falseCount > 0) {
  console.log(`\n⚠️  Detector has false positives. Tighten the heuristic.`);
  process.exit(1);
}

console.log(`\n✓ All sampled files are true positives.`);
