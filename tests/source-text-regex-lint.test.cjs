const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");

const root = require("node:path").resolve(__dirname, "..");
const allowlistPath = join(root, "tests/source-text-regex-allowlist.json");
const { allowlist } = JSON.parse(readFileSync(allowlistPath, "utf8"));
const baseRef = process.env.SOURCE_TEXT_ALLOWLIST_BASE || "origin/production";

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readBaseAllowlist() {
  try {
    git(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]);
  } catch {
    const branch = baseRef.startsWith("origin/") ? baseRef.slice("origin/".length) : baseRef;
    git(["fetch", "--depth=1", "origin", `${branch}:refs/remotes/origin/${branch}`]);
  }
  try {
    const parsed = JSON.parse(git(["show", `${baseRef}:tests/source-text-regex-allowlist.json`]));
    if (!Array.isArray(parsed.allowlist)) {
      throw new Error(`${baseRef} allowlist is missing an allowlist array`);
    }
    return parsed.allowlist;
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString() : "";
    if (/exists on disk, but not in|does not exist in|Path .* does not exist/.test(stderr)) {
      return null;
    }
    throw error;
  }
}

function pathsAdded(basePaths, headPaths) {
  const base = new Set(basePaths);
  return headPaths.filter((path) => !base.has(path));
}

function growthMessage(added) {
  return [
    "The allowlist at tests/source-text-regex-allowlist.json may only shrink.",
    `These paths are not on ${baseRef}:`,
    ...added.map((path) => `  - ${path}`),
    "Assert observable behavior instead (call the function, render the component, hit the route).",
    "Removing a path when a test is fixed is allowed. Adding one is not.",
  ].join("\n");
}

const baseAllowlist = readBaseAllowlist();
const ceiling = baseAllowlist ?? allowlist;

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
  const ceilingSet = new Set(ceiling);
  const newOffenders = currentOffenders.filter((file) => !ceilingSet.has(file));
  
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
      `The ceiling is ${baseAllowlist ? baseRef : "this branch's allowlist, because production does not have the file yet"}.`,
      "The allowlist may only shrink. Existing offenders will be cleaned up in HTPR-7809.",
    ].join("\n");
    
    assert.fail(message);
  }
});

test("the allowlist may only shrink against the production allowlist", () => {
  if (baseAllowlist === null) return;
  const added = pathsAdded(baseAllowlist, allowlist);
  assert.deepEqual(added, [], growthMessage(added));
});

test("a grown allowlist is refused against the base allowlist", () => {
  const base = ["tests/kept.test.cjs"];
  const head = ["tests/kept.test.cjs", "tests/new-source-text.test.cjs"];
  const added = pathsAdded(base, head);
  assert.deepEqual(added, ["tests/new-source-text.test.cjs"]);
  assert.throws(() => assert.deepEqual(added, [], growthMessage(added)), /may only shrink/);
  assert.throws(() => assert.deepEqual(added, [], growthMessage(added)), /tests\/new-source-text\.test\.cjs/);
});

test("git show of a shorter base allowlist refuses the current list", () => {
  const removed = allowlist[allowlist.length - 1];
  const smaller = `${JSON.stringify({
    allowlist: allowlist.filter((path) => path !== removed),
    count: allowlist.length - 1,
  }, null, 2)}\n`;
  const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: root,
    encoding: "utf8",
    input: smaller,
  }).trim();
  const testsTree = execFileSync("git", ["mktree"], {
    cwd: root,
    encoding: "utf8",
    input: `100644 blob ${blob}\tsource-text-regex-allowlist.json\n`,
  }).trim();
  const rootTree = execFileSync("git", ["mktree"], {
    cwd: root,
    encoding: "utf8",
    input: `040000 tree ${testsTree}\ttests\n`,
  }).trim();
  const commit = execFileSync("git", ["commit-tree", rootTree, "-m", "shorter allowlist"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "source-text-allowlist",
      GIT_AUTHOR_EMAIL: "source-text-allowlist@example.invalid",
      GIT_COMMITTER_NAME: "source-text-allowlist",
      GIT_COMMITTER_EMAIL: "source-text-allowlist@example.invalid",
    },
  }).trim();
  const basePaths = JSON.parse(git(["show", `${commit}:tests/source-text-regex-allowlist.json`])).allowlist;
  const added = pathsAdded(basePaths, allowlist);
  assert.deepEqual(added, [removed]);
  assert.throws(() => assert.deepEqual(added, [], growthMessage(added)), /may only shrink/);
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
