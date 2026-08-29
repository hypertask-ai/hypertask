// Picks the subset of tests worth running for a PR's changed files.
//
// PRs pay for the full suite on every push while Vercel's instant rollback is
// the real safety net for staging. So the PR lane runs only the tests that
// reference something the PR touched; the full suite still runs post-merge on
// staging (ci-build.yml push path), with auto-revert on red.
//
// Usage: node .github/scripts/select-tests.mjs [changed-file ...]
//        (reads newline-separated paths from stdin when no args are given)
// Prints "ALL" to run everything, otherwise one test path per line.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { discoverTestFiles } from "../../scripts/test-inventory.mjs";

const root = process.cwd();
const testsRoot = path.join(root, "tests");

// Touching any of these invalidates the whole selection premise (dependency
// graph, schema, tsconfig, the test runner itself), so run everything.
const WIDE_PATTERNS = [
  /^package(-lock)?\.json$/,
  /^prisma\//,
  /^tsconfig.*\.json$/,
  /^next\.config\./,
  /^eslint\.config\./,
  /^middleware\./,
  /^src\/middleware\./,
  /^scripts\/(run-tests|test-inventory)\.mjs$/,
  /^\.github\//,
];

// A shared-dir change with a broad blast radius is not worth guessing about.
const WIDE_FANOUT_DIRS = [/^src\/lib\//, /^src\/utils\//, /^src\/models\//];
const WIDE_FANOUT_THRESHOLD = 5;
const TOTAL_CHANGE_THRESHOLD = 40;

// Cheap suites that guard the runner and the demo path regardless of scope.
const ALWAYS = ["tests/test-inventory.test.cjs", "tests/demo-smoke.test.cjs"];

const isTest = (file) => /^tests\/.*\.test\.(cjs|ts)$/.test(file);

// The result is interpolated into a shell command line, and a PR controls the
// filenames it adds. Anything outside this set is not passed through.
const isShellSafe = (file) => /^[A-Za-z0-9._/-]+$/.test(file);

export async function selectTests(changed) {
  const files = changed.map((f) => f.trim()).filter(Boolean);
  if (files.length === 0) return "ALL";
  if (files.length > TOTAL_CHANGE_THRESHOLD) return "ALL";
  if (files.some((f) => WIDE_PATTERNS.some((p) => p.test(f)))) return "ALL";
  for (const dir of WIDE_FANOUT_DIRS) {
    if (files.filter((f) => dir.test(f)).length > WIDE_FANOUT_THRESHOLD) {
      return "ALL";
    }
  }

  // The inventory is the runner's own list, so a deleted or renamed test never
  // reaches it and nested suites (tests/security/) are included.
  const { supported } = await discoverTestFiles({ root, testsRoot });
  const inventory = new Set(supported);
  const tests = supported.map((file) => [
    file,
    fs.readFileSync(path.join(root, file), "utf8"),
  ]);
  const changedTests = new Set(files.filter((f) => isTest(f) && inventory.has(f)));
  const selected = new Set(changedTests);

  for (const file of files) {
    if (isTest(file)) continue;
    // Match on the repo-relative path only. A basename stem also matches tests
    // that merely mention the word, which reads as coverage the file does not
    // have.
    const matches = tests.filter(([, contents]) => contents.includes(file));
    // Nothing references this file, so the heuristic has no opinion about it.
    // Judged per file, and tests changed by this PR do not count: a test that
    // merely names the file would otherwise buy the PR out of the suite.
    if (matches.every(([t]) => changedTests.has(t))) return "ALL";
    for (const [testPath] of matches) selected.add(testPath);
  }

  // No test mentions anything the PR touched: the heuristic has no opinion, so
  // fall back to the suite rather than reporting a vacuous green.
  if (selected.size === 0) return "ALL";

  for (const file of ALWAYS) if (inventory.has(file)) selected.add(file);
  const result = [...selected].sort();
  // Dropping an unsafe path would quietly shrink the run; widen instead.
  return result.every(isShellSafe) ? result : "ALL";
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const input = args.length > 0 ? args : fs.readFileSync(0, "utf8").split("\n");
  const result = await selectTests(input);
  console.log(result === "ALL" ? "ALL" : result.join("\n"));
}
