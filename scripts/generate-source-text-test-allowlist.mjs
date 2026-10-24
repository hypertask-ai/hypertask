#!/usr/bin/env node
/**
 * Generates an allowlist of test files that read source files as text and regex-match them.
 * These tests assert implementation, not behavior, so they break on harmless refactors.
 * The allowlist may only shrink - adding new entries is blocked by the CI check.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const testsDir = join(root, "tests");

/**
 * Tightened heuristic to detect tests that read source files AND regex-match them.
 * A test is flagged only if it:
 * 1. Reads source files (not fixtures/config) into variables
 * 2. Applies assert.match/doesNotMatch to those specific variables
 */
function detectsSourceTextRegex(testPath) {
  const content = readFileSync(testPath, "utf8");
  
  // Find all variables assigned from readFileSync
  const varPattern = /(?:const|let|var)\s+(\w+)\s*=\s*[^;{]*?readFileSync/g;
  const allVars = [];
  let match;
  while ((match = varPattern.exec(content)) !== null) {
    allVars.push(match[1]);
  }
  
  if (allVars.length === 0) {
    return false;
  }
  
  // Check if any readFileSync call reads a source file
  const readsSource = /readFileSync\s*\([^)]*(?:src\/|lib\/|components\/|pages\/|app\/|\.github\/workflows|eslint-local-rules\/|scripts\/[^/]+\.(?:m?js|tsx?)|tsconfig)/g.test(content);
  
  if (!readsSource) {
    return false;
  }
  
  // Check if any of those variables are used with assert.match or assert.doesNotMatch
  for (const varName of allVars) {
    const assertPattern = new RegExp(`assert\\.(?:match|doesNotMatch)\\s*\\([^,]*\\b${varName}\\b`, 'g');
    if (assertPattern.test(content)) {
      return true;
    }
  }
  
  return false;
}

function discoverTestFiles(dir) {
  const files = [];
  
  function walk(currentDir) {
    const entries = readdirSync(currentDir);
    
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith(".test.cjs") || entry.endsWith(".test.ts")) {
        files.push(fullPath);
      }
    }
  }
  
  walk(dir);
  return files;
}

function generateAllowlist() {
  const testFiles = discoverTestFiles(testsDir);
  const offenders = [];
  
  for (const testFile of testFiles) {
    if (detectsSourceTextRegex(testFile)) {
      offenders.push(relative(root, testFile));
    }
  }
  
  offenders.sort();
  return offenders;
}

// Main execution
const allowlist = generateAllowlist();
const outputPath = join(root, "tests/source-text-regex-allowlist.json");

writeFileSync(
  outputPath,
  JSON.stringify({ allowlist, count: allowlist.length }, null, 2) + "\n"
);

console.log(`Generated allowlist with ${allowlist.length} test files.`);
console.log(`Saved to: ${relative(root, outputPath)}`);

// Also output count to stdout for easy verification
process.stdout.write(`${allowlist.length}\n`);
