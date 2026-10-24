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

const root = process.cwd();
const allowlistPath = join(root, "tests/source-text-regex-allowlist.json");
const { allowlist } = JSON.parse(readFileSync(allowlistPath, "utf8"));

const sampleSize = parseInt(process.argv.find(arg => arg.startsWith('--sample-size='))?.split('=')[1] || '15');

/**
 * Uses the same detector logic as the generator for consistency.
 * Returns { isTrue: boolean, reason: string, evidence: string[] }
 */
function analyzeTrueFalsePositive(testPath) {
  const content = readFileSync(join(root, testPath), "utf8");
  
  // Find all variables assigned from readFileSync
  const varPattern = /(?:const|let|var)\s+(\w+)\s*=\s*[^;{]*?readFileSync/g;
  const allVars = [];
  let match;
  while ((match = varPattern.exec(content)) !== null) {
    allVars.push(match[1]);
  }
  
  if (allVars.length === 0) {
    return {
      isTrue: false,
      reason: "No readFileSync variables found",
      evidence: []
    };
  }
  
  // Check if any readFileSync call reads a source file
  const readsSource = /readFileSync\s*\([^)]*(?:src\/|lib\/|components\/|pages\/|app\/|\.github\/workflows|eslint-local-rules\/|scripts\/[^/]+\.(?:m?js|tsx?)|tsconfig)/g.test(content);
  
  if (!readsSource) {
    return {
      isTrue: false,
      reason: "Only reads non-source files (fixtures/config)",
      evidence: [`Found ${allVars.length} readFileSync calls`]
    };
  }
  
  // Check if any of those variables are used with assert.match or assert.doesNotMatch
  const matchingVars = [];
  for (const varName of allVars) {
    const assertPattern = new RegExp(`assert\\.(?:match|doesNotMatch)\\s*\\([^,]*\\b${varName}\\b`, 'g');
    if (assertPattern.test(content)) {
      matchingVars.push(varName);
    }
  }
  
  if (matchingVars.length === 0) {
    return {
      isTrue: false,
      reason: "Reads source but no assert.match on those variables",
      evidence: [`Variables: ${allVars.join(', ')}`]
    };
  }
  
  return {
    isTrue: true,
    reason: "Reads source AND applies assert.match to it",
    evidence: [`Matched variables: ${matchingVars.join(', ')}`]
  };
}

// Sample evenly across the allowlist
function sampleAllowlist(list, n) {
  if (list.length <= n) return list;
  
  const step = (list.length - 1) / (n - 1);
  const samples = [];
  for (let i = 0; i < n; i++) {
    const index = Math.round(i * step);
    samples.push(list[index]);
  }
  return samples;
}

// Main execution
console.log(`Sampling ${sampleSize} files from ${allowlist.length} allowlisted tests...\n`);

const samples = sampleAllowlist(allowlist, sampleSize);
const results = [];

for (const testPath of samples) {
  const analysis = analyzeTrueFalsePositive(testPath);
  results.push({
    file: testPath,
    truePositive: analysis.isTrue,
    reason: analysis.reason,
    evidence: analysis.evidence
  });
}

// Print results table
console.log("| File | True Positive? | Reason | Evidence |");
console.log("|------|----------------|--------|----------|");

for (const r of results) {
  const fileName = r.file.split('/').pop();
  const evidence = r.evidence.slice(0, 1).join('; ') || 'N/A';
  console.log(`| ${fileName} | ${r.truePositive ? 'YES' : 'NO'} | ${r.reason} | ${evidence} |`);
}

const trueCount = results.filter(r => r.truePositive).length;
const falseCount = results.filter(r => !r.truePositive).length;

console.log(`\n## Summary`);
console.log(`- Sampled: ${sampleSize} files`);
console.log(`- True positives: ${trueCount} (${Math.round(trueCount/sampleSize*100)}%)`);
console.log(`- False positives: ${falseCount} (${Math.round(falseCount/sampleSize*100)}%)`);
console.log(`\nTotal allowlist size: ${allowlist.length}`);

if (falseCount > 0) {
  console.log(`\n⚠️  Detector has false positives. Tighten the heuristic.`);
  process.exit(1);
}

console.log(`\n✓ All sampled files are true positives.`);
