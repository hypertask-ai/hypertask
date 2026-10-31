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
import { LANE_BATCH, batchLaneFiles, classifySuite, partitionSafeFiles, positiveInt } from "./test-lanes.mjs";

const startedAt = performance.now();
const root = process.cwd();
const durationReporter = fileURLToPath(new URL("./test-duration-reporter.mjs", import.meta.url));
const fileDurations = [];
const sharedFileDurations = [];
let timingFiles = 0;
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

const TEST_LANE_FILE_CAP = positiveInt(process.env.TEST_LANE_FILE_CAP ?? LANE_BATCH.maxFiles, "TEST_LANE_FILE_CAP");
const TEST_LANE_BYTE_CAP = positiveInt(process.env.TEST_LANE_BYTE_CAP ?? LANE_BATCH.maxBytes, "TEST_LANE_BYTE_CAP");
const TEST_LANE_CONCURRENCY = positiveInt(process.env.TEST_LANE_CONCURRENCY ?? LANE_BATCH.concurrentFiles, "TEST_LANE_CONCURRENCY");
const TEST_ISOLATION = Number(process.versions.node.split(".")[0]) >= 23
  ? "--test-isolation=none"
  : "--experimental-test-isolation=none";

process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --require=${path.join(testsRoot, "helpers/register-server-only.cjs")}`.trim();

function relative(absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

const quarantineFile = process.env.QUARANTINE_CONFIG || path.join(root, "config/quarantined-tests.json");
const quarantine = loadQuarantine(quarantineFile);
const execution = { stdout: createExecutionCounter(), stderr: createExecutionCounter() };

function run(command, args, label, { concurrency = 1, lane = 0, serial = false, deferred = false } = {}) {
  const nodeTests = args[0] === "--test";
  const runIndex = timingFiles++;
  const timingFile = path.join(timingDirectory, `${runIndex}.jsonl`);
  const todoFile = path.join(timingDirectory, `${runIndex}.tap`);
  if (nodeTests) {
    args = [
      "--test-reporter=spec", "--test-reporter-destination=stdout",
      `--test-reporter=tap`, `--test-reporter-destination=${todoFile}`,
      `--test-reporter=${durationReporter}`, `--test-reporter-destination=${timingFile}`,
      ...args,
    ];
  }
  const runStartedAt = performance.now();
  const buffered = [];
  const write = lane > 0 ? (chunk) => buffered.push(chunk) : (chunk) => process.stdout.write(chunk);
  console.log(lane > 0 ? `\n> ${label} (started)` : `\n> ${label}`);
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
      write(chunk);
      parser.push(chunk);
      execution.stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      write(chunk);
      parser.push(chunk);
      execution.stderr.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (status, signal) => {
      const durationMs = performance.now() - runStartedAt;
      if (lane > 0) for (const chunk of buffered) process.stdout.write(chunk);
      if (nodeTests) {
        if (existsSync(todoFile)) {
          passingTodos.push(...findPassingTodos(readFileSync(todoFile, "utf8")));
          rmSync(todoFile, { force: true });
        }
        for (const line of readFileSync(timingFile, "utf8").trim().split("\n").filter(Boolean)) {
          const entry = JSON.parse(line);
          if (entry.shared) sharedFileDurations.push({ file: entry.file, testMs: entry.durationMs });
          else fileDurations.push({ ...entry, concurrency, serial });
        }
        if (lane > 0) {
          fileDurations.push({ file: label, durationMs, concurrency, lane, fileCount: args.filter((arg) => arg.endsWith(".test.cjs")).length });
        }
      } else {
        fileDurations.push({ file: args.at(-1), durationMs, concurrency, serial });
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
      if (lane > 0) console.log(`\n< ${label} finished in ${(durationMs / 1000).toFixed(1)}s`);
      if (outcome.failCheck && deferred) return resolve({ failed: status || 1 });
      if (outcome.failCheck) process.exit(status ?? 1);
      resolve({ failed: 0 });
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
    const laneRows = fileDurations.filter((file) => file.lane);
    const serialRows = fileDurations.filter((file) => !file.lane && file.serial);
    const poolRows = fileDurations.filter((file) => !file.lane && !file.serial && !file.file.endsWith(".test.ts"));
    const tsRows = fileDurations.filter((file) => !file.lane && !file.serial && file.file.endsWith(".test.ts"));
    const poolWidth = poolRows.reduce((widest, file) => Math.max(widest, file.concurrency), 0);
    const poolEstimatedMs = poolWidth > 0
      ? poolRows.reduce((total, file) => total + file.durationMs, 0) / poolWidth
      : 0;
    const laneWalls = laneRows.reduce((walls, file) => walls.set(file.lane, (walls.get(file.lane) ?? 0) + file.durationMs), new Map());
    const longestLaneMs = laneWalls.size === 0 ? 0 : Math.max(...laneWalls.values());
    const serialDurationMs = serialRows.reduce((total, file) => total + file.durationMs, 0);
    const tsSerialMs = tsRows.reduce((total, file) => total + file.durationMs, 0);
    const laneAdjustedDurationMs = serialDurationMs + Math.max(poolEstimatedMs, longestLaneMs) + tsSerialMs;
    const differencePercent = 100 * (laneAdjustedDurationMs - durationMs) / durationMs;
    const report = {
      durationMs,
      concurrency: TEST_CONCURRENCY,
      cores,
      totalFileDurationMs,
      serialDurationMs,
      poolEstimatedMs,
      longestLaneMs,
      tsSerialMs,
      laneAdjustedDurationMs,
      differencePercent,
      selectedFiles: selected.length,
      recordedRuns: fileDurations.length,
      exitCode: finalExitCode,
      files: fileDurations,
      sharedFiles: sharedFileDurations,
    };
    if (isCi) {
      writeFileSync(path.join(root, "test-durations.json"), `${JSON.stringify(report, null, 2)}\n`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      const seconds = (ms) => (ms / 1000).toFixed(2);
      const recordedFiles = fileDurations.reduce((total, file) => total + (file.fileCount ?? 1), 0);
      const rows = fileDurations.slice(0, 20).map((file, index) =>
        `| ${index + 1} | ${file.file.replaceAll("|", "\\|")} | ${seconds(file.durationMs)} | ${file.fileCount ?? 1} |`,
      );
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        "\n## Slowest 20 test processes",
        `Recorded ${recordedFiles}/${selected.length} selected files in ${fileDurations.length} process runs; runner exit code: ${finalExitCode}.`,
        "",
        "| Rank | Process | Duration (s) | Files |",
        "| ---: | --- | ---: | ---: |",
        ...rows,
        "",
        `Expected wall time: serial fixtures ${seconds(serialDurationMs)}s, then the slower of own-process pool ${seconds(poolEstimatedMs)}s and longest shared lane ${seconds(longestLaneMs)}s, then serial TypeScript ${seconds(tsSerialMs)}s = ${seconds(laneAdjustedDurationMs)}s; elapsed runner: ${seconds(durationMs)}s; difference: ${differencePercent.toFixed(1)}% (target: within 20%).`,
        `A shared lane is one process for every safe file it carried, so it reports one wall time for all of them. Remaining elapsed time includes lane startup, shard inventory and reporter overhead; npm/heavy-job startup is outside this runner measurement.`,
        "Durations are whole child-process wall time, not sums of nested test durations. TypeScript files are timed around their existing serial tsx invocation.",
        "",
      ].join("\n"));
    }
  } finally {
    rmSync(timingDirectory, { recursive: true, force: true });
  }
});

if (cjsTests.length > 0) {
  const { serial, pool, safe, weightOf } = await classifySuite({ root, files: cjsTests });
  for (const file of serial) {
    await run(process.execPath, ["--test", FILE_TIMEOUT, file], `Isolated Node test: ${file}`, { serial: true });
  }
  const width = Math.max(1, Number(TEST_CONCURRENCY));
  let poolFiles = safe.length > 1 ? pool : [...pool, ...safe];
  let sharedFiles = safe.length > 1 ? safe : [];
  const weightOfClass = (files) => files.reduce((total, file) => total + weightOf(file), 0);
  const laneBudget = poolFiles.length === 0 ? width : width - 1;
  const pickLanes = () => {
    const poolWeight = weightOfClass(poolFiles);
    const safeWeight = weightOfClass(sharedFiles);
    return Math.min(laneBudget, Math.max(1, Math.round(width * safeWeight / Math.max(1, safeWeight + poolWeight))));
  };
  let lanes = sharedFiles.length === 0 || laneBudget < 1 ? 0 : pickLanes();
  if (lanes === 0 && sharedFiles.length > 0) {
    poolFiles = [...poolFiles, ...sharedFiles];
    sharedFiles = [];
  }
  const poolWidth = Math.max(1, width - lanes);
  console.log(`Shared lanes: ${lanes} for ${sharedFiles.length} safe files; own-process files: ${poolFiles.length} at pool width ${poolFiles.length > 0 ? poolWidth : 0}.`);
  const jobs = [];
  if (poolFiles.length > 0) {
    jobs.push(run(
      process.execPath,
      ["--test", FILE_TIMEOUT, `--test-concurrency=${poolWidth}`, ...poolFiles],
      `Own-process Node tests (${poolFiles.length} files, ${poolWidth} wide)`,
      { concurrency: poolWidth, deferred: true },
    ));
  }
  const laneGroups = partitionSafeFiles(sharedFiles, lanes, weightOf);
  for (const [index, files] of laneGroups.entries()) {
    const batches = batchLaneFiles(files, { maxFiles: TEST_LANE_FILE_CAP, maxBytes: TEST_LANE_BYTE_CAP, weightOf });
    jobs.push((async () => {
      for (const [batchIndex, batch] of batches.entries()) {
        const label = batches.length === 1
          ? `Shared Node lane ${index + 1}/${laneGroups.length} (${batch.length} files)`
          : `Shared Node lane ${index + 1}/${laneGroups.length}, batch ${batchIndex + 1}/${batches.length} (${batch.length} files)`;
        const result = await run(
          process.execPath,
          ["--test", FILE_TIMEOUT, `--test-concurrency=${TEST_LANE_CONCURRENCY}`, TEST_ISOLATION, ...batch],
          label,
          { concurrency: laneGroups.length, lane: index + 1, deferred: true },
        );
        if (result.failed) return result;
      }
      return { failed: 0 };
    })());
  }
  const results = await Promise.all(jobs);
  const failed = results.find((result) => result.failed);
  if (failed) process.exit(failed.failed);
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
