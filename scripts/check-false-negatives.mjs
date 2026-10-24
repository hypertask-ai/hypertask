#!/usr/bin/env node
/**
 * Checks for false negatives: files that were on the old allowlist but
 * are no longer detected by the tightened heuristic.
 * 
 * Samples dropped files to verify they were correctly removed (true negatives)
 * and not incorrectly dropped (false negatives = real offenders we now miss).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();

// Get old allowlist from previous commit
const oldCommit = process.argv[2] || "934f6e2b";
let oldAllowlist;
try {
  const oldJson = execSync(`git show ${oldCommit}:tests/source-text-regex-allowlist.json`, {
    encoding: 'utf8',
    cwd: root
  });
  oldAllowlist = JSON.parse(oldJson).allowlist;
} catch (e) {
  console.error(`Failed to read old allowlist from ${oldCommit}`);
  process.exit(1);
}

const currentAllowlist = JSON.parse(
  readFileSync(join(root, "tests/source-text-regex-allowlist.json"), "utf8")
).allowlist;

const dropped = oldAllowlist.filter(f => !currentAllowlist.includes(f));

console.log(`Found ${dropped.length} files dropped from allowlist\n`);

// Sample evenly
const sampleSize = 15;
function sampleArray(arr, n) {
  if (arr.length <= n) return arr;
  const step = (arr.length - 1) / (n - 1);
  const samples = [];
  for (let i = 0; i < n; i++) {
    const index = Math.round(i * step);
    samples.push(arr[index]);
  }
  return samples;
}

const samples = sampleArray(dropped, sampleSize);

/**
 * Manually check if a dropped file is actually a source-text regex test
 * that the new detector misses (FALSE NEGATIVE).
 */
function isActuallySourceTextRegex(testPath) {
  const fullPath = join(root, testPath);
  if (!existsSync(fullPath)) {
    return { isFalseNegative: false, reason: "File no longer exists", evidence: [] };
  }
  
  const content = readFileSync(fullPath, "utf8");
  
  // Check if it reads source files
  const readsSource = /readFileSync\s*\([^)]*(?:src\/|lib\/|components\/|pages\/|app\/|\.github\/workflows|eslint-local-rules\/|scripts\/[^/]+\.(?:m?js|tsx?)|tsconfig)/g.test(content);
  
  if (!readsSource) {
    return { isFalseNegative: false, reason: "Does not read source files", evidence: [] };
  }
  
  // Check if it uses assert.match or assert.doesNotMatch
  const hasAssertMatch = /assert\.(match|doesNotMatch)\s*\(/g.test(content);
  
  if (!hasAssertMatch) {
    return { isFalseNegative: false, reason: "No assert.match found", evidence: [] };
  }
  
  // Find all readFileSync variables
  const varPattern = /(?:const|let|var)\s+(\w+)\s*=\s*[^;{]*?readFileSync/g;
  const allVars = [];
  let match;
  while ((match = varPattern.exec(content)) !== null) {
    allVars.push(match[1]);
  }
  
  // Check if any variable is used with assert.match
  const matchedVars = [];
  for (const varName of allVars) {
    const assertPattern = new RegExp(`assert\\.(?:match|doesNotMatch)\\s*\\([^,]*\\b${varName}\\b`, 'g');
    if (assertPattern.test(content)) {
      matchedVars.push(varName);
    }
  }
  
  if (matchedVars.length > 0) {
    // This IS a source-text regex test, but the detector didn't catch it
    return { 
      isFalseNegative: true, 
      reason: "Reads source AND applies assert.match - MISSED BY DETECTOR",
      evidence: [`Variables: ${allVars.join(', ')}`, `Matched: ${matchedVars.join(', ')}`]
    };
  }
  
  // It reads source and has assert.match, but not on the readFileSync variables
  // This is correctly dropped - probably asserts on something else
  return {
    isFalseNegative: false,
    reason: "assert.match not on readFileSync variables",
    evidence: [`Variables: ${allVars.join(', ')}`, "assert.match on different data"]
  };
}

console.log("Sampling 15 dropped files for false negatives...\n");
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
console.log(`- Sampled: ${sampleSize} dropped files`);
console.log(`- False negatives (real offenders we now miss): ${falseNegatives}`);
console.log(`- Correct drops (not source-text regex tests): ${correctDrops}`);
console.log(`- Total dropped: ${dropped.length}`);

if (falseNegatives > 0) {
  console.log(`\n⚠️  Detector has false negatives - it misses real source-text regex tests.`);
  process.exit(1);
}

console.log(`\n✓ All sampled dropped files were correctly removed.`);
