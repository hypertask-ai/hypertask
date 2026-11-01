const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const yaml = require("js-yaml");

const workflow = () => yaml.load(readFileSync(".github/workflows/ci-tests.yml", "utf8"));
const launcherName = "Run independent static checks";
const lanes = [
  "agent-board-scope",
  "board-registration-boundaries",
  "changed-style-tokens",
  "contracts",
  "eslint",
  "lint-overlap-guard",
  "oxlint",
  "paid-api-cost-notes",
  "typescript",
];
const formerSteps = [
  "Board filter and sort contracts",
  "Changed style tokens",
  "Check board registration boundaries",
  "Guard agent board scope",
  "Lint (eslint, rules Oxlint lacks)",
  "Lint (oxlint)",
  "Lint overlap guard",
  "Paid API cost notes",
  "Settings Ctrl+K coverage",
  "Source-text regex gate",
  "Typecheck",
];

const laneFunctions = (run) => [...run.matchAll(/^ *lane_([a-z_]+)\(\) \{$/gm)].map((match) => match[1].replaceAll("_", "-")).sort();
const laneLaunches = (run) => [...run.matchAll(/^ *run_lane (\S+)$/gm)].map((match) => match[1]).sort();

function assertParallelChecks(ci) {
  const checks = ci.jobs["ci-checks"];
  assert.ok(checks, "static checks need their own job");
  assert.equal(checks.needs, "ci-prepare");
  assert.equal(ci.jobs["ci-test"].needs, "ci-prepare");
  assert.equal(checks.if, "needs.ci-prepare.outputs.run_tests == 'true' || needs.ci-prepare.outputs.boundary_needed == 'true'");
  assert.equal(checks["runs-on"], "ubuntu-latest");
  assert.deepEqual(checks.permissions, { contents: "read" });
  assert.deepEqual(ci.jobs["ci-tests"].needs, ["ci-prepare", "ci-checks", "ci-test", "ci-fixtures"]);
  const fixtures = ci.jobs["ci-fixtures"];
  assert.ok(fixtures, "fixture regressions need their own lane");
  assert.equal(fixtures.needs, "ci-prepare");
  assert.equal(
    fixtures.if,
    "needs.ci-prepare.outputs.stress_fixtures == 'true' || needs.ci-prepare.outputs.handoff_fixture == 'true'",
  );
  for (const name of ["Stress cold-board query fixtures", "Fixture handoff in one process"]) {
    assert.ok(!ci.jobs["ci-prepare"].steps.some((step) => step.name === name), `${name} blocks ci-prepare`);
    assert.equal(fixtures.steps.filter((step) => step.name === name).length, 1, name);
  }

  const launchers = checks.steps.filter((step) => step.name === launcherName);
  assert.equal(launchers.length, 1, "one launcher runs every static gate");
  const [launcher] = launchers;
  assert.equal(launcher.if, "needs.ci-prepare.outputs.run_tests == 'true' || needs.ci-prepare.outputs.boundary_needed == 'true'");
  assert.equal(launcher["continue-on-error"], undefined);
  for (const name of formerSteps) {
    assert.equal(checks.steps.filter((step) => step.name === name).length, 0, `${name} is a lane, not a step`);
  }
  for (const job of ["ci-prepare", "ci-test"]) {
    for (const name of lanes) {
      assert.ok(!ci.jobs[job].steps.some((step) => String(step.name ?? "").includes(name)), `${name} blocks ${job}`);
    }
  }
  const { run } = launcher;
  const flagIndex = run.indexOf("node scripts/generate-flag-index.mjs");
  assert.ok(flagIndex >= 0, "the typescript lane builds the generated flag index itself");
  assert.ok(flagIndex < run.indexOf("npx tsc --noEmit"), "the flag index exists before tsc reads it");
  assert.ok(
    run.indexOf("npx tsc --noEmit --incremental --tsBuildInfoFile .cache/tsc/tsbuildinfo") > flagIndex,
    "tsc keeps its incremental build info in the cached directory",
  );
  assert.deepEqual(laneFunctions(run), lanes, "every gate is a lane");
  assert.deepEqual(laneLaunches(run), lanes, "every lane is launched");
  assert.match(run, /\) > "\$LOGS\/\$name\.log" 2>&1 &$/m, "lanes start in the background, they do not wait for each other");
  assert.match(run, /^ *while read -r name pid; do$/m);
  assert.match(run, /^ *if wait "\$pid"; then$/m);
  assert.match(run, /^ *exit 1$/m);
  assert.ok(
    run.indexOf("run_lane board-registration-boundaries") < run.indexOf('if [ "$RUN_TESTS" = "true" ]'),
    "the boundary gate also guards the boundary-only run",
  );
  for (const gated of lanes.filter((name) => name !== "board-registration-boundaries")) {
    assert.ok(run.indexOf(`run_lane ${gated}`) > run.indexOf('if [ "$RUN_TESTS" = "true" ]'), `${gated} is a TypeScript or lint gate`);
  }

  const generated = checks.steps.findIndex((step) => step.name === "Generate Prisma client and flag index");
  assert.ok(generated >= 0, "the generated sources are built before the lanes");
  assert.ok(generated < checks.steps.indexOf(launcher), "generated sources exist before any lane reads them");
  assert.match(launcher.run, /node scripts\/generate-flag-index\.mjs/, "the typescript lane rebuilds the flag index it reads");
  const saves = checks.steps.filter((step) => step.uses?.startsWith("actions/cache/save@"));
  assert.equal(saves.length, 3);
  const pushOnly = saves.filter((step) => step.name !== "Save TypeScript cache");
  for (const step of pushOnly) {
    assert.match(step.if, /^needs\.ci-prepare\.outputs\.run_tests == 'true' && \(github\.event_name == 'push' && steps\.[\w-]+\.outputs\.cache-hit != 'true'\)$/);
    assert.ok(checks.steps.indexOf(step) > checks.steps.indexOf(launcher), `${step.name} waits for its lane`);
  }
  assertTrustedTypeScriptCache(checks.steps);
}

function assertTrustedTypeScriptCache(steps) {
  const restore = steps.find((step) => step.name === "Restore TypeScript cache");
  const save = steps.find((step) => step.name === "Save TypeScript cache");
  assert.ok(restore && save, "TypeScript cache steps exist");
  assert.equal(
    save.if,
    "needs.ci-prepare.outputs.run_tests == 'true' && steps.restore-tsc-cache.outputs.cache-hit != 'true'",
    "the TypeScript cache may fill from a pull request only inside its own namespace",
  );
  assert.equal(save.with.key, "${{ steps.restore-tsc-cache.outputs.cache-primary-key }}");
  const namespace = restore.env.TSC_CACHE_NAMESPACE;
  assert.match(namespace, /github\.event_name == 'pull_request' && format\('pr-\{0\}', github\.event\.pull_request\.number\) \|\| 'prod'/);
  assert.match(restore.with.key, /^tsc-\$\{\{ env\.TSC_CACHE_NAMESPACE \}\}-/);
  const restoreKeys = restore.with["restore-keys"].trim().split("\n").map((line) => line.trim());
  for (const key of restoreKeys) {
    assert.ok(
      key.startsWith("tsc-${{ env.TSC_CACHE_NAMESPACE }}-") || key.startsWith("tsc-prod-"),
      `production must never restore a pull-request cache: ${key}`,
    );
  }
}

function mutated(change) {
  const ci = workflow();
  change(ci);
  return ci;
}

test("static checks and shards share preparation, not a serial dependency", () => {
  assertParallelChecks(workflow());
  assert.throws(() => assertParallelChecks(mutated((ci) => {
    ci.jobs["ci-test"].needs = ["ci-prepare", "ci-checks"];
  })));
  assert.throws(() => assertParallelChecks(mutated((ci) => {
    ci.jobs["ci-tests"].needs = ["ci-prepare", "ci-test"];
  })));
  assert.throws(() => assertParallelChecks(mutated((ci) => {
    ci.jobs["ci-checks"].if = "needs.ci-prepare.outputs.run_tests == 'true'";
  })));
  assert.throws(() => assertParallelChecks(mutated((ci) => {
    ci.jobs["ci-checks"].steps.find((step) => step.uses?.startsWith("actions/cache/save@")).if = "always()";
  })));
});

test("static gates run together, so a serialised gate fails the contract", () => {
  assertParallelChecks(workflow());
  const launcher = (ci) => ci.jobs["ci-checks"].steps.find((step) => step.name === launcherName);
  assert.throws(() => assertParallelChecks(mutated((ci) => {
    launcher(ci).run = launcher(ci).run.replace(' 2>&1 &', " 2>&1");
  })), "a gate that waits for the previous one");
  assert.throws(() => assertParallelChecks(mutated((ci) => {
    launcher(ci).run = launcher(ci).run.replace("  run_lane eslint\n", "");
  })), "a gate dropped from the launcher");
  assert.throws(() => assertParallelChecks(mutated((ci) => {
    launcher(ci)["continue-on-error"] = true;
  })), "a launcher that cannot fail");
  assert.throws(() => assertParallelChecks(mutated((ci) => {
    ci.jobs["ci-checks"].steps.push({ name: "Typecheck", run: "npx tsc --noEmit" });
  })), "a gate pulled back out into its own step");
  assert.throws(() => assertParallelChecks(mutated((ci) => {
    launcher(ci).run = launcher(ci).run.replace("  run_lane agent-board-scope\n", "");
  })), "a TypeScript or lint gate lost");
});

function publish(ci, prepare, runTests, checks, shards, proof, boundaryNeeded = "false", fixtures = "skipped") {
  const step = ci.jobs["ci-tests"].steps.find((step) => step.name === "Publish ci-tests result");
  const values = {
    "needs.ci-prepare.result": prepare,
    "needs.ci-prepare.outputs.run_tests": runTests,
    "needs.ci-prepare.outputs.boundary_needed": boundaryNeeded,
    "needs.ci-checks.result": checks,
    "needs.ci-test.result": shards,
    "needs.ci-fixtures.result": fixtures,
    "steps.prove.outcome": proof,
  };
  const command = step.run.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, expression) => {
    assert.ok(Object.hasOwn(values, expression), expression);
    return values[expression];
  });
  return spawnSync("bash", ["-c", command], { encoding: "utf8", env: { PATH: process.env.PATH } }).status;
}

test("static checks and shards share preparation, not a serial dependency", () => {
  const ci = workflow();
  assertParallelChecks(ci);
  const serial = structuredClone(ci);
  serial.jobs["ci-test"].needs = ["ci-prepare", "ci-checks"];
  assert.throws(() => assertParallelChecks(serial));
  const missingGate = structuredClone(ci);
  missingGate.jobs["ci-tests"].needs = ["ci-prepare", "ci-test"];
  assert.throws(() => assertParallelChecks(missingGate));
  const missingBoundary = structuredClone(ci);
  missingBoundary.jobs["ci-checks"].if = "needs.ci-prepare.outputs.run_tests == 'true'";
  assert.throws(() => assertParallelChecks(missingBoundary));
  const unsafeCache = structuredClone(ci);
  unsafeCache.jobs["ci-checks"].steps.find((step) => step.uses?.startsWith("actions/cache/save@")).if = "always()";
  assert.throws(() => assertParallelChecks(unsafeCache));
  const leakedTypeScriptCache = structuredClone(ci);
  leakedTypeScriptCache.jobs["ci-checks"].steps
    .find((step) => step.name === "Restore TypeScript cache")
    .with["restore-keys"] += "\n            tsc-pr-${{ runner.os }}-\n";
  assert.throws(() => assertParallelChecks(leakedTypeScriptCache));
});

test("a fixture regression still fails ci-tests from its own lane", () => {
  const ci = workflow();
  assert.equal(publish(ci, "success", "true", "success", "success", "success", "false", "success"), 0);
  assert.equal(publish(ci, "success", "true", "success", "success", "success", "false", "skipped"), 0);
  for (const result of ["failure", "cancelled", ""]) {
    assert.notEqual(
      publish(ci, "success", "true", "success", "success", "success", "false", result),
      0,
      `fixtures ${result}`,
    );
  }
  const serialised = structuredClone(ci);
  serialised.jobs["ci-prepare"].steps.push(serialised.jobs["ci-fixtures"].steps.at(-1));
  assert.throws(() => assertParallelChecks(serialised), "a fixture run back in front of every shard");
  const ungated = structuredClone(ci);
  delete ungated.jobs["ci-tests"].needs;
  assert.throws(() => assertParallelChecks(ungated));
});

test("real summary shell rejects failed, cancelled, skipped or missing static checks", () => {
  const ci = workflow();
  assert.equal(publish(ci, "success", "true", "success", "success", "success"), 0);
  for (const result of ["failure", "cancelled", "skipped", ""]) {
    assert.notEqual(publish(ci, "success", "true", result, "success", "success"), 0, `static ${result}`);
    assert.notEqual(publish(ci, "success", "true", "success", result, "success"), 0, `shards ${result}`);
    assert.notEqual(publish(ci, "success", "true", "success", "success", result), 0, `proof ${result}`);
    assert.notEqual(publish(ci, result, "true", "success", "success", "success"), 0, `prepare ${result}`);
  }
});

test("docs-only summary accepts only successful preparation and both heavy jobs skipped", () => {
  const ci = workflow();
  assert.equal(publish(ci, "success", "false", "skipped", "skipped", "skipped"), 0);
  for (const result of ["failure", "cancelled", "success", ""]) {
    assert.notEqual(publish(ci, "success", "false", result, "skipped", "skipped"), 0, `static ${result}`);
    assert.notEqual(publish(ci, "success", "false", "skipped", result, "skipped"), 0, `shards ${result}`);
  }
  assert.notEqual(publish(ci, "failure", "false", "skipped", "skipped", "skipped"), 0);
});

test("boundary-only summary requires successful checks and skipped shards", () => {
  const ci = workflow();
  assert.equal(publish(ci, "success", "false", "success", "skipped", "skipped", "true"), 0);
  for (const result of ["failure", "cancelled", "skipped", ""]) {
    assert.notEqual(publish(ci, "success", "false", result, "skipped", "skipped", "true"), 0, `checks ${result}`);
  }
  for (const result of ["failure", "cancelled", "success", ""]) {
    assert.notEqual(publish(ci, "success", "false", "success", result, "skipped", "true"), 0, `shards ${result}`);
  }
});

test("summary rejects invalid or missing scope outputs", () => {
  const ci = workflow();
  for (const invalid of ["", "invalid"]) {
    assert.notEqual(publish(ci, "success", invalid, "skipped", "skipped", "skipped", "false"), 0);
    assert.notEqual(publish(ci, "success", "false", "skipped", "skipped", "skipped", invalid), 0);
  }
});
