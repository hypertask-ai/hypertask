const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

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
