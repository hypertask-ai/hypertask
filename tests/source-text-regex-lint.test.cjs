const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");

const root = require("node:path").resolve(__dirname, "..");
const allowlistPath = join(root, "tests/source-text-regex-allowlist.json");
const { allowlist } = JSON.parse(readFileSync(allowlistPath, "utf8"));

/**
 * Heuristic to detect tests that read source files as text and regex-match them.
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
