const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const yaml = require("js-yaml");

const workflowPath = ".github/workflows/ci-tests.yml";

test("the dependency cache is invalidated by every install input", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const key = workflow.match(/^\s+key: node-modules-.+$/m)?.[0];

  assert.ok(key, "node_modules cache key is missing");
  assert.equal(
    key,
    "          key: node-modules-${{ runner.os }}-${{ runner.arch }}-abi${{ steps.dependency-cache-version.outputs.node-abi }}-npm${{ steps.dependency-cache-version.outputs.npm-major }}-${{ hashFiles('package-lock.json', 'package.json', '.npmrc') }}",
  );
});

test("pull requests can read but cannot publish dependency caches", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(
    workflow,
    /if: github\.event_name == 'push' && steps\.restore-node-modules\.outputs\.cache-hit != 'true'\n\s+uses: actions\/cache\/save@/,
  );
  assert.match(
    workflow,
    /if: \(github\.event_name == 'push' \|\| steps\.scope\.outputs\.build_needed == 'true'\) && steps\.restore-node-modules\.outputs\.cache-hit != 'true'/,
  );
  assert.match(workflow, /run: npm ci --prefer-offline --no-audit --no-fund/);
});

test("visual comparison restores the producer's exact dependency caches per phase", () => {
  const workflow = yaml.load(readFileSync(workflowPath, "utf8"));
  const producer = workflow.jobs["ci-prepare"].steps;
  const steps = workflow.jobs["visual-compare"].steps;
  const source = producer.find(step => step.id === "restore-node-modules");
  const resolve = steps.find(step => step.id === "dependency-cache-version");
  const capture = steps.find(step => step.name === "Build and capture base, then compare head");
  assert.equal(resolve.run, producer.find(step => step.id === "dependency-cache-version").run);
  assert.equal(resolve.if, "steps.scope.outputs.visual_needed != 'false'");
  assert.equal(steps.some(step => step.uses?.startsWith("actions/cache/save@")), false);

  for (const phase of ["base", "head"]) {
    const restore = steps.find(step => step.id === `restore-${phase}-node-modules`);
    const stage = steps.find(step => step.name === `Stage ${phase} node_modules`);
    assert.equal(restore.uses, source.uses);
    assert.equal(restore.with.path, source.with.path);
    assert.equal(restore.with.path, "node_modules");
    assert.equal(restore.with.key, source.with.key.replace(/'([^']+)'/g, `'${phase}/$1'`));
    assert.equal(restore.with["restore-keys"], undefined);
    assert.equal(restore.if, phase === "base"
      ? "steps.scope.outputs.visual_needed != 'false' && steps.baseline-cache.outputs.cache-hit != 'true' && steps.baseline-artifact.outputs.hit != 'true'"
      : "steps.scope.outputs.visual_needed != 'false'");
    assert.equal(stage.if, `steps.restore-${phase}-node-modules.outputs.cache-hit == 'true'`);
    assert.equal(stage.run, `mv node_modules ${phase}/node_modules`);
    assert.ok(steps.indexOf(resolve) < steps.indexOf(restore));
    assert.ok(steps.indexOf(restore) < steps.indexOf(stage));
    assert.ok(steps.indexOf(stage) < steps.indexOf(capture));
    assert.equal(capture.env[`VISUAL_${phase.toUpperCase()}_DEPENDENCIES_CACHED`], `\${{ steps.restore-${phase}-node-modules.outputs.cache-hit == 'true' }}`);
  }
  assert.ok(steps.indexOf(steps.find(step => step.name === "Stage base node_modules")) < steps.findIndex(step => step.id === "restore-head-node-modules"));
});

test("every job that installs root dependencies restores the shared node_modules cache", () => {
  const workflow = yaml.load(readFileSync(workflowPath, "utf8"));
  const installJobs = Object.entries(workflow.jobs)
    .map(([name, job]) => ({ name, steps: job.steps ?? [] }))
    .filter((job) => job.steps.some((step) => /^\s*npm ci --prefer-offline --no-audit --no-fund\s*$/m.test(step.run ?? "")));

  assert.ok(installJobs.length >= 4, `expected every install job, found ${installJobs.map((job) => job.name).join(", ")}`);
  for (const job of installJobs) {
    const restore = job.steps.find((step) => step.with?.path === "node_modules" && String(step.uses ?? "").includes("cache/restore@"));
    assert.ok(restore, `${job.name} installs dependencies without restoring node_modules`);
    for (const step of job.steps.filter((candidate) => /^\s*npm ci --prefer-offline --no-audit --no-fund\s*$/m.test(candidate.run ?? ""))) {
      assert.match(String(step.if), /restore-node-modules\.outputs\.cache-hit != 'true'/, `${job.name} installs dependencies even when the cache hit`);
    }
  }
});
