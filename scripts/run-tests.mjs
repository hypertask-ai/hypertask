import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  discoverTestFiles,
  supportedTestSuffixes,
} from "./test-inventory.mjs";

const root = process.cwd();
const testsRoot = path.join(root, "tests");

function relative(absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function run(command, args, label) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.signal) {
    console.error(`${label} terminated by ${result.signal}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const requested = process.argv.slice(2);
const { candidates, supported, unsupported } = await discoverTestFiles({
  root,
  testsRoot,
});

if (unsupported.length > 0) {
  console.error("Unsupported test files are committed and would be skipped:");
  for (const file of unsupported) console.error(`- ${file}`);
  console.error(`Supported suffixes: ${supportedTestSuffixes.join(", ")}`);
  process.exit(1);
}

let selected = supported;
if (requested.length > 0) {
  selected = requested.map((file) => relative(path.resolve(root, file)));
  const unknown = selected.filter((file) => !supported.includes(file));
  if (unknown.length > 0) {
    console.error("Requested files are not supported committed tests:");
    for (const file of unknown) console.error(`- ${file}`);
    process.exit(1);
  }
}

const cjsTests = selected.filter((file) => file.endsWith(".test.cjs"));
const tsTests = selected.filter((file) => file.endsWith(".test.ts"));

// These route tests deliberately replace TypeScript modules through
// require.cache. Run them in separate workers before the shared suite so their
// fixtures cannot race with one another or with another cache-mutating test.
const isolatedCjsTests = new Set([
  "tests/management-key-route.test.cjs",
  "tests/management-key-route-wiring.test.cjs",
  "tests/mcp-usage-auth.test.cjs",
  "tests/mcp-usage-route.test.cjs",
  "tests/oauth-authorize-session-identity.test.cjs",
]);

console.log(
  `Test inventory: ${cjsTests.length} Node tests, ${tsTests.length} TypeScript tests.`,
);

if (cjsTests.length > 0) {
  const isolated = cjsTests.filter((file) => isolatedCjsTests.has(file));
  const shared = cjsTests.filter((file) => !isolatedCjsTests.has(file));
  for (const file of isolated) {
    run(process.execPath, ["--test", file], `Isolated Node test: ${file}`);
  }
  if (shared.length > 0) {
    // Cap at 4 workers: the default (one per core) put 18+ node processes on
    // the shared box whenever CI and an agent ran the suite (owner, 2026-08-25).
    run(process.execPath, ["--test", "--test-concurrency=4", ...shared], "Node test suite");
  }
}

const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
for (const file of tsTests) {
  run(process.execPath, [tsxCli, file], `TypeScript test: ${file}`);
}
