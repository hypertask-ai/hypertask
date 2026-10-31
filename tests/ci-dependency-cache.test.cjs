const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const yaml = require("js-yaml");

const workflowPath = ".github/workflows/ci-tests.yml";
const rootInstall = /^\s*npm ci --prefer-offline --no-audit --no-fund\s*$/m;

function installJobs() {
  const workflow = yaml.load(readFileSync(workflowPath, "utf8"));
  return Object.entries(workflow.jobs)
    .map(([name, job]) => ({ name, steps: job.steps || [] }))
    .filter((job) => job.steps.some((step) => rootInstall.test(step.run || "")))
    .map((job) => ({
      name: job.name,
      steps: job.steps,
      restore: job.steps.find((step) => step.with?.path === "node_modules"),
      install: job.steps.find((step) => rootInstall.test(step.run || "")),
      npmRestore: job.steps.find((step) => step.with?.path === "~/.npm"),
      setupNode: job.steps.find((step) => String(step.uses ?? "").startsWith("actions/setup-node@")),
    }));
}

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

test("every job that installs root dependencies restores the shared node_modules cache", () => {
  const jobs = installJobs();
  assert.ok(jobs.length >= 4, `expected every install job, found ${jobs.map((job) => job.name).join(", ")}`);

  for (const job of jobs) {
    assert.ok(job.restore, `${job.name} installs dependencies without restoring node_modules`);
    assert.match(
      String(job.install.if),
      /restore-node-modules\.outputs\.cache-hit != 'true'/,
      `${job.name} installs dependencies even when the cache hit`,
    );
  }
});

test("every install job keeps npm downloads warm and reads them only on a node_modules miss", () => {
  for (const job of installJobs()) {
    if (job.setupNode?.with?.cache === "npm") continue;

    assert.ok(job.npmRestore, `${job.name} has no warm npm download cache`);
    assert.match(
      String(job.npmRestore.if),
      /restore-node-modules\.outputs\.cache-hit != 'true'/,
      `${job.name} pays for the npm download cache even when node_modules hit`,
    );
    assert.match(String(job.npmRestore.with?.key), /^npm-cache-\$\{\{ runner\.os \}\}/);
    assert.ok(job.npmRestore.with?.["restore-keys"], `${job.name} has no lockfile-independent npm cache fallback`);
  }
});

test("only production pushes seed the npm download cache", () => {
  for (const job of installJobs()) {
    const save = job.steps.find(
      (step) => String(step.uses ?? "").startsWith("actions/cache/save@") && step.with?.path === "~/.npm",
    );
    if (!save) continue;

    assert.match(String(save.if), /github\.event_name == 'push'/);
    assert.match(String(save.if), /restore-node-modules\.outputs\.cache-hit != 'true'/);
    assert.match(String(save.if), /restore-npm-cache\.outputs\.cache-hit != 'true'/);
  }
});
