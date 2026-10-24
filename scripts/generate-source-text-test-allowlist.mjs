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
 * Heuristic to detect tests that read source files and regex-match them.
 * A test is flagged if it:
 * 1. Uses readFileSync (or similar read operations)
 * 2. Contains regex operations on the read content (match, test, assert.match, etc.)
 * 3. Reads from paths that look like source files (not test fixtures or config)
 */
function detectsSourceTextRegex(testPath) {
  const content = readFileSync(testPath, "utf8");
  
  // Skip if it doesn't read files
  if (!content.includes("readFileSync")) {
    return false;
  }
  
  // Check for regex operations that might be applied to source files
  const hasRegexOps = 
    content.includes(".match(") ||
    content.includes(".test(") ||
    content.includes("assert.match") ||
    content.includes("assert.doesNotMatch") ||
    content.includes("assert.ok(") && content.includes("RegExp") ||
    content.includes("/\\/");  // Regex literals
  
  if (!hasRegexOps) {
    return false;
  }
  
  // Check if it's reading source files (not test fixtures or package.json only)
  // Source files are typically in src/, lib/, components/, pages/, app/, or workflow files
  const readsSourceFiles =
    /readFileSync[^)]*['"`](?:\.\.\/)?(?:src|lib|components|pages|app|\.github\/workflows|eslint|tsconfig|scripts|\.claude)/.test(content) ||
    /read\([^)]*['"`](?:src|lib|components|pages|app|\.github\/workflows|eslint)/.test(content);
  
  return hasRegexOps && readsSourceFiles;
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
