const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");

const root = require("node:path").resolve(__dirname, "..");
const allowlistPath = join(root, "tests/source-text-regex-allowlist.json");
const { allowlist } = JSON.parse(readFileSync(allowlistPath, "utf8"));

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

test("no new tests read source files as text and regex-match them", () => {
  const testsDir = join(root, "tests");
  const testFiles = discoverTestFiles(testsDir);
  const currentOffenders = [];
  
  for (const testFile of testFiles) {
    if (detectsSourceTextRegex(testFile)) {
      currentOffenders.push(relative(root, testFile));
    }
  }
  
  currentOffenders.sort();
  const allowlistSet = new Set(allowlist);
  
  // Find new offenders (tests not in the allowlist)
  const newOffenders = currentOffenders.filter(test => !allowlistSet.has(test));
  
  if (newOffenders.length > 0) {
    const message = [
      "\nNew tests that read source files as text and regex-match them were detected:",
      ...newOffenders.map(file => `  - ${file}`),
      "",
      "These tests assert implementation, not behavior. They break on harmless refactors.",
      "",
      "Fix: Assert observable behavior instead:",
      "  - Call the function and check its return value",
      "  - Render the component and verify the output",
      "  - Hit the route and check the response",
      "",
      "The allowlist at tests/source-text-regex-allowlist.json may only shrink.",
      "Existing offenders will be cleaned up in HTPR-7809.",
    ].join("\n");
    
    assert.fail(message);
  }
});

test("the allowlist may only shrink", () => {
  const testsDir = join(root, "tests");
  const testFiles = discoverTestFiles(testsDir);
  const currentOffenders = [];
  
  for (const testFile of testFiles) {
    if (detectsSourceTextRegex(testFile)) {
      currentOffenders.push(relative(root, testFile));
    }
  }
  
  assert.ok(
    currentOffenders.length <= allowlist.length,
    `Allowlist grew from ${allowlist.length} to ${currentOffenders.length} tests. ` +
    `The allowlist may only shrink. If you fixed tests, regenerate the allowlist with: ` +
    `node scripts/generate-source-text-test-allowlist.mjs`
  );
});

test("the allowlist count matches the detected offenders", () => {
  const testsDir = join(root, "tests");
  const testFiles = discoverTestFiles(testsDir);
  const currentOffenders = [];
  
  for (const testFile of testFiles) {
    if (detectsSourceTextRegex(testFile)) {
      currentOffenders.push(relative(root, testFile));
    }
  }
  
  currentOffenders.sort();
  const allowlistSet = new Set(allowlist);
  
  // Find tests in allowlist that no longer offend
  const fixedTests = allowlist.filter(test => !currentOffenders.includes(test));
  
  if (fixedTests.length > 0) {
    const message = [
      `\nThe allowlist contains ${fixedTests.length} test(s) that no longer read source files as text:`,
      ...fixedTests.slice(0, 10).map(file => `  - ${file}`),
      ...(fixedTests.length > 10 ? [`  ... and ${fixedTests.length - 10} more`] : []),
      "",
      "Regenerate the allowlist with: node scripts/generate-source-text-test-allowlist.mjs",
    ].join("\n");
    
    assert.fail(message);
  }
});
