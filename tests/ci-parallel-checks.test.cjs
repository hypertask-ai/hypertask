const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const yaml = require("js-yaml");

const workflow = () => yaml.load(readFileSync(".github/workflows/ci-tests.yml", "utf8"));
const staticSteps = ["Guard agent board scope", "Typecheck", "Lint"];

function assertParallelChecks(ci) {
  const checks = ci.jobs["ci-checks"];
  assert.ok(checks, "static checks need their own job");
  assert.equal(checks.needs, "ci-prepare");
  assert.equal(ci.jobs["ci-test"].needs, "ci-prepare");
  assert.equal(checks.if, "needs.ci-prepare.outputs.run_tests == 'true' || needs.ci-prepare.outputs.boundary_needed == 'true'");
  assert.equal(checks["runs-on"], "ubuntu-latest");
  assert.deepEqual(checks.permissions, { contents: "read" });
  assert.deepEqual(ci.jobs["ci-tests"].needs, ["ci-prepare", "ci-checks", "ci-test"]);
  for (const name of staticSteps) {
    assert.equal(checks.steps.filter((step) => step.name === name).length, 1, name);
    assert.equal(checks.steps.find((step) => step.name === name).if, "needs.ci-prepare.outputs.run_tests == 'true'", name);
    assert.equal(checks.steps.find((step) => step.name === name)["continue-on-error"], undefined, name);
    for (const job of ["ci-prepare", "ci-test"]) {
      assert.ok(!ci.jobs[job].steps.some((step) => step.name === name), `${name} blocks ${job}`);
    }
  }
  assert.ok(checks.steps.findIndex((step) => step.name === "Generate Prisma client") < checks.steps.findIndex((step) => step.name === "Typecheck"));
  const boundary = checks.steps.filter((step) => step.name === "Check board registration boundaries");
  assert.equal(boundary.length, 1);
  assert.equal(boundary[0].if, undefined);
  const saves = checks.steps.filter((step) => step.uses?.startsWith("actions/cache/save@"));
  assert.equal(saves.length, 3);
  for (const step of saves) {
    assert.match(step.if, /^needs\.ci-prepare\.outputs\.run_tests == 'true' && \(github\.event_name == 'push' && steps\.[\w-]+\.outputs\.cache-hit != 'true'\)$/);
  }
}

function publish(ci, prepare, runTests, checks, shards, proof, boundaryNeeded = "false") {
  const step = ci.jobs["ci-tests"].steps.find((step) => step.name === "Publish ci-tests result");
  const values = {
    "needs.ci-prepare.result": prepare,
    "needs.ci-prepare.outputs.run_tests": runTests,
    "needs.ci-prepare.outputs.boundary_needed": boundaryNeeded,
    "needs.ci-checks.result": checks,
    "needs.ci-test.result": shards,
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
