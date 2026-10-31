import path from "node:path";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  discoverTestFiles,
  supportedTestSuffixes,
} from "./test-inventory.mjs";
import { checkOutcome, createTapParser, loadQuarantine } from "./test-quarantine.mjs";
import { combineCounters, createExecutionCounter, executionFailure } from "./test-execution-count.mjs";
import { findPassingTodos, todoRemovalMessages } from "./todo-passing.mjs";

const startedAt = performance.now();
const root = process.cwd();
const durationReporter = fileURLToPath(new URL("./test-duration-reporter.mjs", import.meta.url));
const fileDurations = [];
const passingTodos = [];
let timingDirectory;
const testsRoot = path.join(root, "tests");
const FILE_TIMEOUT = `--test-timeout=${process.env.TEST_FILE_TIMEOUT_MS ?? 20 * 60 * 1000}`;
const isCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS !== undefined;
const cores = Math.max(1, availableParallelism());
const TEST_CONCURRENCY = laneCount(process.env.TEST_CONCURRENCY);

function laneCount(override) {
  if (override === undefined || override === "") return isCi ? cores : Math.min(cores, 2);
  const lanes = Number(override);
  if (!Number.isInteger(lanes) || lanes < 1) throw new Error(`TEST_CONCURRENCY must be a positive integer, got ${override}`);
  return lanes;
}

process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --require=${path.join(testsRoot, "helpers/register-server-only.cjs")}`.trim();

function relative(absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

const quarantineFile = process.env.QUARANTINE_CONFIG || path.join(root, "config/quarantined-tests.json");
const quarantine = loadQuarantine(quarantineFile);
const execution = { stdout: createExecutionCounter(), stderr: createExecutionCounter() };

function run(command, args, label, concurrency = 1) {
  const nodeTests = args[0] === "--test";
  const timingFile = path.join(timingDirectory, `${fileDurations.length}.jsonl`);
  const todoFile = path.join(timingDirectory, `${fileDurations.length}.tap`);
  if (nodeTests) {
    args = [
      "--test-reporter=spec", "--test-reporter-destination=stdout",
      `--test-reporter=tap`, `--test-reporter-destination=${todoFile}`,
      `--test-reporter=${durationReporter}`, `--test-reporter-destination=${timingFile}`,
      ...args,
    ];
  }
  const runStartedAt = performance.now();
  console.log(`\n> ${label}`);
  const parser = createTapParser();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      parser.push(chunk);
      execution.stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      parser.push(chunk);
      execution.stderr.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (status, signal) => {
      if (nodeTests) {
        if (existsSync(todoFile)) {
          passingTodos.push(...findPassingTodos(readFileSync(todoFile, "utf8")));
          rmSync(todoFile, { force: true });
        }
        for (const line of readFileSync(timingFile, "utf8").trim().split("\n").filter(Boolean)) {
          fileDurations.push({ ...JSON.parse(line), concurrency });
        }
      } else {
        fileDurations.push({ file: args.at(-1), durationMs: performance.now() - runStartedAt, concurrency });
      }
      const outcome = checkOutcome(status ?? 1, parser.finish(), quarantine);
      if (signal) {
        console.error(`${label} terminated by ${signal}`);
        process.exit(1);
      }
      if (outcome.quarantined.length > 0) {
        console.error(`Quarantine: ${outcome.quarantined.length} failing test(s) still ran and did not fail the check.`);
        for (const failure of outcome.quarantined) {
          const entry = quarantine.find((item) => item.test === failure.name || (failure.file || "").endsWith(item.test));
          console.error(`- ${failure.name} (${entry?.owner || "unowned"} ${entry?.ticket || ""})`);
        }
      }
      if (outcome.failCheck) process.exit(status ?? 1);
      resolve();
    });
  });
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

const isolatedCjsTests = new Set([
  "tests/action-archive-cache.test.cjs",
  "tests/agent-run-activities.test.cjs",
  "tests/feature-flags.test.cjs",
  "tests/htpr-6478-regressions.test.cjs",
  "tests/management-key-route.test.cjs",
  "tests/management-key-route-wiring.test.cjs",
  "tests/mcp-usage-auth.test.cjs",
  "tests/mcp-usage-route.test.cjs",
  "tests/oauth-authorize-session-identity.test.cjs",
]);

console.log(`Test lanes: ${TEST_CONCURRENCY} of ${cores} cores.`);
console.log(
  `Test inventory: ${cjsTests.length} Node tests, ${tsTests.length} TypeScript tests.`,
);

timingDirectory = mkdtempSync(path.join(tmpdir(), "hypertask-test-durations-"));
process.on("exit", (exitCode) => {
  for (const message of todoRemovalMessages(passingTodos, root)) console.error(message);
  const finalExitCode = passingTodos.length > 0 ? exitCode || 1 : exitCode;
  if (finalExitCode !== exitCode) process.exitCode = finalExitCode;
  try {
    const durationMs = performance.now() - startedAt;
    fileDurations.sort((a, b) => b.durationMs - a.durationMs || a.file.localeCompare(b.file));
    const totalFileDurationMs = fileDurations.reduce((total, file) => total + file.durationMs, 0);
    const concurrencyAdjustedDurationMs = totalFileDurationMs / TEST_CONCURRENCY;
    const laneAdjustedDurationMs = fileDurations.reduce((total, file) => total + file.durationMs / file.concurrency, 0);
    const differencePercent = 100 * (concurrencyAdjustedDurationMs - durationMs) / durationMs;
    const report = {
      durationMs,
      concurrency: TEST_CONCURRENCY,
      cores,
      totalFileDurationMs,
      concurrencyAdjustedDurationMs,
      laneAdjustedDurationMs,
      differencePercent,
      selectedFiles: selected.length,
      recordedFiles: fileDurations.length,
      exitCode: finalExitCode,
      files: fileDurations,
    };
    if (isCi) {
      writeFileSync(path.join(root, "test-durations.json"), `${JSON.stringify(report, null, 2)}\n`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      const seconds = (ms) => (ms / 1000).toFixed(2);
      const rows = fileDurations.slice(0, 20).map((file, index) =>
        `| ${index + 1} | ${file.file.replaceAll("|", "\\|")} | ${seconds(file.durationMs)} | ${file.concurrency} |`,
      );
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        "\n## Slowest 20 test files",
        `Recorded ${fileDurations.length}/${selected.length} selected files; runner exit code: ${finalExitCode}.`,
        "",
        "| Rank | File | Duration (s) | Lane concurrency |",
        "| ---: | --- | ---: | ---: |",
        ...rows,
        "",
        `Total file time: ${seconds(totalFileDurationMs)}s / concurrency ${TEST_CONCURRENCY} = ${seconds(concurrencyAdjustedDurationMs)}s; elapsed runner: ${seconds(durationMs)}s; difference: ${differencePercent.toFixed(1)}% (target: within 20%).`,
        `Accounting for serial isolated/TypeScript lanes: ${seconds(laneAdjustedDurationMs)}s. Remaining elapsed time includes worker startup, scheduling/idle slots, inventory and reporter overhead; npm/heavy-job startup is outside this runner measurement.`,
        "File durations are whole child-process wall time, not sums of nested test durations. TypeScript files are timed around their existing serial tsx invocation.",
        "",
      ].join("\n"));
    }
  } finally {
    rmSync(timingDirectory, { recursive: true, force: true });
  }
});

if (cjsTests.length > 0) {
  const isolated = cjsTests.filter((file) => isolatedCjsTests.has(file));
  const shared = cjsTests.filter((file) => !isolatedCjsTests.has(file));
  for (const file of isolated) {
    await run(process.execPath, ["--test", FILE_TIMEOUT, file], `Isolated Node test: ${file}`);
  }
  if (shared.length > 0) {
    await run(process.execPath, ["--test", FILE_TIMEOUT, `--test-concurrency=${TEST_CONCURRENCY}`, ...shared], "Node test suite", Number(TEST_CONCURRENCY));
  }
}

const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
for (const file of tsTests) {
  await run(process.execPath, [tsxCli, file], `TypeScript test: ${file}`);
}

const counted = combineCounters(execution.stdout.finish(), execution.stderr.finish());
const skippedRun = isCi && selected.length > 0 ? executionFailure(counted, selected.length) : null;
if (skippedRun) {
  console.error(skippedRun);
  process.exit(1);
}
