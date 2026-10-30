#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { detectSourceTextRegex, sampleEvenly } from "./lib/source-text-regex-detector.cjs";

const root = process.cwd();
const oldCommit = process.argv[2] || "934f6e2b";
let oldAllowlist;
try {
  const oldJson = execSync(`git show ${oldCommit}:tests/source-text-regex-allowlist.json`, {
    encoding: 'utf8',
    cwd: root
  });
  oldAllowlist = JSON.parse(oldJson).allowlist;
} catch {
  console.error(`Failed to read old allowlist from ${oldCommit}`);
  process.exit(1);
}

const currentAllowlist = JSON.parse(
  readFileSync(join(root, "tests/source-text-regex-allowlist.json"), "utf8")
).allowlist;

const dropped = oldAllowlist.filter(f => !currentAllowlist.includes(f));

console.log(`Found ${dropped.length} files dropped from allowlist\n`);

const sampleSize = 15;
const samples = sampleEvenly(dropped, sampleSize);

function isActuallySourceTextRegex(testPath) {
  const fullPath = join(root, testPath);
  if (!existsSync(fullPath)) {
    return { isFalseNegative: false, reason: "File no longer exists", evidence: [] };
  }

  const { offender, matchedVariables } = detectSourceTextRegex(readFileSync(fullPath, "utf8"));
  return {
    isFalseNegative: offender,
    reason: offender ? "Reads source AND applies assert.match - MISSING FROM ALLOWLIST" : "No source read is regex-matched by its own binding",
    evidence: matchedVariables.length > 0 ? [`Matched: ${matchedVariables.join(', ')}`] : []
  };
}

console.log(`Sampling ${samples.length} dropped files for false negatives...\n`);
console.log("| File | False Negative? | Reason | Evidence |");
console.log("|------|-----------------|--------|----------|");

const results = [];
for (const testPath of samples) {
  const analysis = isActuallySourceTextRegex(testPath);
  const fileName = testPath.split('/').pop();
  const evidence = analysis.evidence.slice(0, 1).join('; ') || 'N/A';
  console.log(`| ${fileName} | ${analysis.isFalseNegative ? '**YES**' : 'NO'} | ${analysis.reason} | ${evidence} |`);
  results.push(analysis);
}

const falseNegatives = results.filter(r => r.isFalseNegative).length;
const correctDrops = results.filter(r => !r.isFalseNegative).length;

console.log(`\n## Summary`);
console.log(`- Sampled: ${samples.length} dropped files`);
console.log(`- False negatives (real offenders we now miss): ${falseNegatives}`);
console.log(`- Correct drops (not source-text regex tests): ${correctDrops}`);
console.log(`- Total dropped: ${dropped.length}`);

if (falseNegatives > 0) {
  console.log(`\n⚠️  Detector has false negatives - it misses real source-text regex tests.`);
  process.exit(1);
}

console.log(`\n✓ All sampled dropped files were correctly removed.`);
