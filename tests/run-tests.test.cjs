const assert = require("node:assert/strict");
const { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const yaml = require("js-yaml");

const root = path.resolve(__dirname, "..");

function fixture(t, sources) {
  const directory = mkdtempSync(path.join(tmpdir(), "run-tests-timings-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const folder of ["scripts", "config", "tests/helpers", "node_modules/tsx/dist"]) mkdirSync(path.join(directory, folder), { recursive: true });
  for (const file of ["run-tests.mjs", "test-inventory.mjs", "test-duration-reporter.mjs", "test-quarantine.mjs", "test-execution-count.mjs", "todo-passing.mjs"]) {
    copyFileSync(path.join(root, "scripts", file), path.join(directory, "scripts", file));
  }
  writeFileSync(path.join(directory, "tests/helpers/register-server-only.cjs"), "");
  writeFileSync(path.join(directory, "config/quarantined-tests.json"), '{"tests":[]}');
  writeFileSync(path.join(directory, "node_modules/tsx/dist/cli.mjs"), `import { readFileSync } from 'node:fs'; eval(readFileSync(process.argv[2], 'utf8'));`);
  for (const [file, source] of Object.entries(sources)) writeFileSync(path.join(directory, "tests", file), source);
  return directory;
}

function run(directory, files = [], overrides = {}) {
  const result = spawnSync(process.execPath, ["scripts/run-tests.mjs", ...files], {
    cwd: directory,
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, NODE_OPTIONS: "", CI: "true", TEST_CONCURRENCY: "2", GITHUB_STEP_SUMMARY: path.join(directory, "summary.md"), ...overrides },
    encoding: "utf8",
    timeout: 20000,
  });
  const reportFile = path.join(directory, "test-durations.json");
  return { ...result, report: existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, "utf8")) : null, summary: readFileSync(path.join(directory, "summary.md"), "utf8") };
}

test("runner publishes all files, descending top 20 and concurrency/serial accounting", (t) => {
  const sources = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [
    `shared-${index}.test.cjs`, `require('node:test')('shared ${index}', () => {});`,
  ]));
  sources["action-archive-cache.test.cjs"] = `require('node:test')('isolated fixture', () => {});`;
  sources["serial.test.ts"] = `console.log('serial TypeScript fixture');`;
  const directory = fixture(t, sources);
  const { status, stderr, stdout, report, summary } = run(directory);
  assert.equal(status, 0, stderr);
  assert.match(stdout, /isolated fixture/);
  assert.match(stdout, /shared 0/);
  assert.match(stdout, /serial TypeScript fixture/);
  assert.equal(report.selectedFiles, 23);
  assert.equal(report.recordedFiles, 23);
  assert.equal(report.exitCode, 0);
  assert.deepEqual(report.files.map(({ file }) => file).sort(), Object.keys(sources).map(file => `tests/${file}`).sort());
  for (let index = 1; index < report.files.length; index++) assert.ok(report.files[index - 1].durationMs >= report.files[index].durationMs);
  const isolated = report.files.filter(({ concurrency }) => concurrency === 1);
  assert.deepEqual(isolated.map(({ file }) => file).sort(), ["tests/action-archive-cache.test.cjs", "tests/serial.test.ts"]);
  assert.equal(report.concurrency, 2);
  assert.equal(report.totalFileDurationMs, report.files.reduce((sum, file) => sum + file.durationMs, 0));
  assert.equal(report.concurrencyAdjustedDurationMs, report.totalFileDurationMs / 2);
  assert.equal(report.laneAdjustedDurationMs, report.files.reduce((sum, file) => sum + file.durationMs / file.concurrency, 0));
  assert.equal(report.differencePercent, 100 * (report.concurrencyAdjustedDurationMs - report.durationMs) / report.durationMs);
  assert.ok(report.durationMs >= Math.max(...report.files.map(({ durationMs }) => durationMs)));
  const rows = summary.split("\n").filter(line => /^\| \d+ \|/.test(line));
  assert.equal(rows.length, 20);
  assert.deepEqual(rows.map(line => line.split(" | ")[1]), report.files.slice(0, 20).map(({ file }) => file));
  assert.match(summary, /Recorded 23\/23/);
  assert.match(summary, /serial isolated\/TypeScript lanes/);
  assert.match(summary, /npm\/heavy-job startup is outside/);
});

test("CI runs one lane per core unless TEST_CONCURRENCY overrides it", (t) => {
  const directory = fixture(t, { "lane.test.cjs": `require('node:test')('lane fixture', () => {});` });
  const { status, report, stdout, stderr } = run(directory, [], { TEST_CONCURRENCY: "" });
  assert.equal(status, 0, stderr);
  const cores = Math.max(1, require("node:os").availableParallelism());
  assert.equal(report.cores, cores);
  assert.equal(report.concurrency, cores);
  assert.match(stdout, new RegExp(`Test lanes: ${cores} of ${cores} cores\\.`));
});

test("an invalid TEST_CONCURRENCY fails the run instead of guessing a lane count", (t) => {
  const directory = fixture(t, { "lane.test.cjs": `require('node:test')('lane fixture', () => {});` });
  for (const value of ["0", "-1", "two", "1.5"]) {
    const result = spawnSync(process.execPath, ["scripts/run-tests.mjs"], {
      cwd: directory,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, NODE_OPTIONS: "", CI: "true", TEST_CONCURRENCY: value },
      encoding: "utf8",
      timeout: 20000,
    });
    assert.notEqual(result.status, 0, value);
    assert.match(result.stderr, new RegExp(`TEST_CONCURRENCY must be a positive integer, got ${value.replace(".", "\\.")}`));
  }
});

test("runner honors selected files and overwrites previous timing JSON", (t) => {
  const directory = fixture(t, {
    "chosen.test.cjs": `require('node:test')('chosen fixture', () => {});`,
    "other.test.cjs": `throw Error('unselected fixture ran');`,
  });
  writeFileSync(path.join(directory, "test-durations.json"), '{"stale":true}');
  const { status, report, stdout, stderr } = run(directory, ["tests/chosen.test.cjs"]);
  assert.equal(status, 0, stderr);
  assert.match(stdout, /chosen fixture/);
  assert.doesNotMatch(stdout, /unselected fixture ran/);
  assert.equal(report.selectedFiles, 1);
  assert.deepEqual(report.files.map(({ file }) => file), ["tests/chosen.test.cjs"]);
  assert.equal(report.stale, undefined);
});

test("a selection whose tests all skip fails the run instead of showing green", (t) => {
  const directory = fixture(t, {
    "silently-skipped.test.cjs": `require('node:test')('hidden change', { skip: 'never runs' }, () => { throw Error('must not run'); });`,
  });
  const { status, stderr, report } = run(directory, ["tests/silently-skipped.test.cjs"]);
  assert.equal(status, 1);
  assert.match(stderr, /No test executed: 1 test file\(s\) selected, 1 skipped/);
  assert.equal(report.exitCode, 1);
  assert.equal(report.selectedFiles, 1);
});

test("the same all-skipped selection stays green outside CI", (t) => {
  const directory = fixture(t, {
    "silently-skipped.test.cjs": `require('node:test')('hidden change', { skip: 'never runs' }, () => { throw Error('must not run'); });`,
  });
  const { status, stderr } = run(directory, ["tests/silently-skipped.test.cjs"], { CI: undefined, GITHUB_ACTIONS: undefined });
  assert.equal(status, 0, stderr);
  assert.doesNotMatch(stderr, /No test executed/);
});

test("one executed test is enough to keep a partially skipped selection green", (t) => {
  const directory = fixture(t, {
    "silently-skipped.test.cjs": `require('node:test')('hidden change', { skip: 'never runs' }, () => { throw Error('must not run'); });`,
    "healthy.test.cjs": `require('node:test')('ordinary case', () => {});`,
  });
  const { status, stderr } = run(directory, ["tests/silently-skipped.test.cjs", "tests/healthy.test.cjs"]);
  assert.equal(status, 0, stderr);
  assert.doesNotMatch(stderr, /No test executed/);
});

test("failed isolated files still publish partial evidence and preserve failure status", (t) => {
  const directory = fixture(t, {
    "action-archive-cache.test.cjs": `require('node:test')('failure fixture', () => { throw Error('fixture failed'); });`,
    "later.test.cjs": `throw Error('should not run after isolated failure');`,
  });
  const { status, stdout, report, summary } = run(directory);
  assert.equal(status, 1);
  assert.match(stdout, /fixture failed/);
  assert.equal(report.exitCode, 1);
  assert.equal(report.selectedFiles, 2);
  assert.equal(report.recordedFiles, 1);
  assert.deepEqual(report.files.map(({ file }) => file), ["tests/action-archive-cache.test.cjs"]);
  assert.match(summary, /Recorded 1\/2/);
});

test("production full-suite uploads timing JSON even after test failure, not on PRs", () => {
  const workflow = yaml.load(readFileSync(path.join(root, ".github/workflows/ci-tests.yml"), "utf8"));
  const steps = workflow.jobs["ci-tests"].steps;
  const shardSteps = workflow.jobs["ci-test"].steps;
  const collect = shardSteps.find(step => step.name === "Collect test durations");
  const upload = steps.find(step => step.name === "Upload test durations");
  assert.deepEqual(workflow.on.push.branches, ["production"]);
  assert.equal(collect.if, "always() && github.event_name == 'push' && steps.push-test.outcome != 'skipped'");
  assert.match(collect.run, /cp test-durations.json "\$RUNNER_TEMP\/ci-shard-upload\/test-durations.json"/);
  assert.ok(shardSteps.indexOf(collect) > shardSteps.findIndex(step => step.id === "push-test"));
  assert.ok(shardSteps.indexOf(collect) < shardSteps.findIndex(step => step.name === "Upload shard result"));
  assert.equal(upload.if, "always() && github.event_name == 'push' && needs.ci-prepare.outputs.run_tests == 'true'");
  assert.equal(upload.uses, "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
  assert.equal(upload.with.path, "ci-shard-results/**/test-durations.json");
  assert.equal(upload.with.name, "test-durations");
  assert.ok(steps.indexOf(upload) > steps.findIndex(step => step.name === "Download shard results"));
});

for (const extraFailure of [false, true]) {
  test(`timing reporter retains quarantine semantics with unrelated failure=${extraFailure}`, (t) => {
    const directory = fixture(t, {
      "quarantined.test.cjs": `require('node:test')('known flaky #1', () => { throw Error('known failure'); });`,
      "healthy.test.cjs": `require('node:test')('ordinary case', () => { ${extraFailure ? "throw Error('new failure');" : ""} });`,
    });
    writeFileSync(path.join(directory, "config/quarantined-tests.json"), JSON.stringify({ tests: [{ test: "known flaky #1" }] }));
    const { status, report, stderr } = run(directory);
    assert.equal(status, extraFailure ? 1 : 0, stderr);
    assert.match(stderr, /- known flaky #1 \(unowned \)/);
    assert.doesNotMatch(stderr, /- ordinary case/);
    assert.equal(report.recordedFiles, 2);
    assert.equal(report.exitCode, extraFailure ? 1 : 0);
  });
}

test("passing todo fails the run and names the marker to remove", (t) => {
  const directory = fixture(t, {
    "passing.test.cjs": `require('node:test')('repaired fixture', { todo: 'HTPR-1 known bug' }, () => {});`,
    "healthy.test.cjs": `require('node:test')('ordinary case', () => {});`,
  });
  const { status, stderr, report } = run(directory);
  assert.equal(status, 1, stderr);
  assert.match(stderr, /remove the todo marker: not found in tests repaired fixture\n/);
  assert.equal(report.exitCode, 1);
});

test("known-bug todo that still fails keeps the run green", (t) => {
  const directory = fixture(t, {
    "failing.test.cjs": `require('node:test')('broken fixture', { todo: 'HTPR-1 known bug' }, () => { throw Error('still broken'); });`,
    "healthy.test.cjs": `require('node:test')('ordinary case', () => {});`,
  });
  const { status, stderr } = run(directory);
  assert.equal(status, 0, stderr);
  assert.doesNotMatch(stderr, /remove the todo marker:/);
});

test("a real failure keeps its own exit status alongside a passing todo", (t) => {
  const directory = fixture(t, {
    "passing.test.cjs": `require('node:test')('repaired before failure', { todo: 'HTPR-1 known bug' }, () => {});`,
    "typescript.test.ts": "",
  });
  writeFileSync(path.join(directory, "node_modules/tsx/dist/cli.mjs"), "process.exit(7);");
  const { status, stderr } = run(directory);
  assert.equal(status, 7, stderr);
  assert.match(stderr, /remove the todo marker: not found in tests repaired before failure/);
});

test("the todo scan reads known-bug todos only, including indented and CRLF output", async () => {
  const { findPassingTodos } = await import(pathToFileURL(path.join(root, "scripts/todo-passing.mjs")).href);
  assert.deepEqual(findPassingTodos([
    "TAP version 13",
    "ok 1 - bare placeholder # TODO",
    "ok 2 - repaired bug # TODO HTPR-5888 stale known bug",
    "not ok 3 - still broken # TODO HTPR-5888 known bug",
    "ok 4 - skipped # SKIP",
    "ok 5 - skipped todo # TODO # SKIP",
    "ok 6 - ordinary test",
    "# ok 7 - logged text # TODO",
    "    ok 8 - nested bug # TODO HTPR-5888 nested  ",
  ].join("\r\n")), ["repaired bug", "nested bug"]);
  assert.deepEqual(findPassingTodos(""), []);
});
