const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const yaml = require("js-yaml");
const { compareNodeVersions, workflowNodeVersions } = require("../.github/scripts/check-node-version.cjs");

const workflows = [{ file: "ci.yml", content: "jobs:\n  test:\n    steps:\n      - uses: actions/setup-node@sha\n        with:\n          node-version: 24\n" }];

test("matching package and workflow majors pass", () => {
  for (const engine of ["24", "24.x", "24.1.2", "^24.1.2", "~24.1.2"]) {
    assert.deepEqual(compareNodeVersions("24.x", engine, workflows), []);
  }
});

test("the incident's package downgrade is rejected", () => {
  assert.match(compareNodeVersions("24.x", "22.x", workflows).join("\n"), /package.json engines.node.*22.x.*Vercel.*24.x/);
});

test("every workflow is checked, including quoted and inline node versions", () => {
  const inputs = [...workflows, { file: "second.yaml", content: 'jobs: {test: {steps: [{with: {node-version: "22.x"}}, {with: {node-version: 20}}]}}' }];
  const issues = compareNodeVersions("24.x", "24.x", inputs);
  assert.equal(issues.length, 2);
  assert.match(issues[0], /second.yaml.*22.x/);
  assert.match(issues[1], /second.yaml.*20/);
});

test("comments and unrelated numeric inputs do not count", () => {
  assert.deepEqual(workflowNodeVersions("# node-version: 22\njobs: {test: {steps: [{with: {timeout: 22}}]}}"), []);
});

test("missing or ambiguous versions fail closed", () => {
  for (const live of [undefined, "", "latest", "24.x || 22.x"]) {
    assert.throws(() => compareNodeVersions(live, "24.x", workflows), /Vercel/);
  }
  for (const engine of [undefined, "", ">=22", "22.x || 24.x"]) {
    assert.match(compareNodeVersions("24.x", engine, workflows).join("\n"), /package.json engines.node/);
  }
  for (const setting of ['"${{ matrix.node }}"', '"lts/*"', "[22, 24]", "[24]", "{major: 24}"]) {
    assert.match(compareNodeVersions("24.x", "24.x", [{ file: "dynamic.yml", content: `jobs: {test: {steps: [{with: {node-version: ${setting}}}]}}` }]).join("\n"), /dynamic.yml.*single Node major/);
  }
});

test("invalid YAML fails instead of silently missing settings", () => {
  assert.throws(() => workflowNodeVersions("jobs: ["));
});

test("YAML aliases are checked without looping on recursive aliases", () => {
  const versions = workflowNodeVersions('defaults: &node {node-version: "22.x"}\njobs: {test: {steps: [{with: *node}]}}\nloop: &loop {self: *loop}');
  assert.equal(versions.length, 1);
  assert.equal(versions[0].value, "22.x");
});

test("node-version-file cannot silently bypass comparison", () => {
  assert.match(compareNodeVersions("24.x", "24.x", [{ file: "file.yml", content: 'jobs: {test: {steps: [{with: {node-version-file: ".nvmrc"}}]}}' }]).join("\n"), /node-version-file/);
});

test("CLI reads real package/workflow files and returns a failing exit on mismatch", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "node-version-guard-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
  fs.writeFileSync(path.join(root, ".github/workflows/ci.yml"), workflows[0].content);
  const liveFile = path.join(root, "live-version");
  fs.writeFileSync(liveFile, "24.x\n");
  const script = path.resolve(".github/scripts/check-node-version.cjs");
  const run = () => spawnSync(process.execPath, [script, liveFile], { cwd: root, encoding: "utf8" });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ engines: { node: "24.x" } }));
  assert.equal(run().status, 0);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ engines: { node: "22.x" } }));
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /package.json engines.node is 22.x, but live Vercel nodeVersion is 24.x/);
  assert.doesNotMatch(result.stdout, /guard passed/);
  fs.writeFileSync(liveFile, "");
  assert.equal(run().status, 1);
});

test("the API request alone receives the Vercel secret and missing settings fail closed", () => {
  const workflow = yaml.load(fs.readFileSync(".github/workflows/node-version-guard.yml", "utf8"));
  assert.ok(workflow.on.pull_request);
  assert.deepEqual(workflow.on.push.branches, ["production"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const steps = workflow.jobs["node-version-guard"].steps;
  const apiJob = workflow.jobs["vercel-node-version"];
  assert.equal(apiJob.steps.length, 1);
  const apiStep = apiJob.steps[0];
  assert.match(apiStep.run, /api\.vercel\.com\/v9\/projects\/prj_oEok2iMNFPzj6AWe1KQBaIAcPaAf\?teamId=team_yureFlJZ6ibwebaOOkKc5whs/);
  assert.match(apiStep.run, /set -euo pipefail/);
  assert.match(apiStep.run, /curl --fail/);
  assert.match(apiStep.run, /jq -er '\.nodeVersion/);
  assert.equal(apiStep.env.VERCEL_TOKEN, "${{ secrets.VERCEL_TOKEN }}");
  assert.ok(!apiStep.uses, "credentialed runner must not check out PR code");
  assert.equal(workflow.jobs["node-version-guard"].needs, "vercel-node-version");
  assert.doesNotMatch(JSON.stringify(workflow.jobs["node-version-guard"]), /VERCEL_TOKEN|secrets\./);
  assert.ok(!workflow.jobs["node-version-guard"].env);
  assert.ok(steps.some((step) => step.run?.includes("node .github/scripts/check-node-version.cjs")));
});
