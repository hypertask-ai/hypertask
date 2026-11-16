import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the boot holds for the verifier and the job strips the model key before containers start", () => {
  const isolated = read("scripts/run-app-smoke-isolated.sh");
  const hold = isolated.indexOf("PSTACK_VERIFIER_HOLD:-");
  const harness = isolated.indexOf("run-shared-core-actions-smoke.mjs");
  assert.ok(hold > 0 && hold < harness);
  assert.match(isolated, /127\.0\.0\.1:3100:3100/);
  const job = read("scripts/pstack-verifier-job.sh");
  const unsetAt = job.indexOf("unset OPENROUTER_EVAL_KEY OPENCODE_API_KEY");
  const bootAt = job.indexOf("run-app-smoke-isolated.sh");
  const driveAt = job.indexOf('OPENROUTER_EVAL_KEY="$key" node');
  assert.ok(unsetAt > 0 && unsetAt < bootAt && bootAt < driveAt);
  assert.match(job, /env -u OPENROUTER_EVAL_KEY -u OPENCODE_API_KEY/);
});

test("pstack-verifier is an optional production workflow_run check", () => {
  const request = read(".github/workflows/pstack-verifier-request.yml");
  const trusted = read(".github/workflows/pstack-verifier.yml");
  const policy = read("docs/ci-policy.yml");
  assert.match(request, /permissions: \{\}/);
  assert.doesNotMatch(request, /secrets\./);
  assert.match(trusted, /workflows: \["Pstack Verifier Request"\]/);
  assert.doesNotMatch(trusted, /pull_request:/);
  assert.equal(trusted.match(/persist-credentials: false/g).length, 2);
  assert.match(trusted, /path: candidate/);
  assert.match(trusted, /ref: \$\{\{ github\.sha \}\}/);
  assert.equal(trusted.split("\n").filter((line) => line.includes("OPENROUTER_EVAL_KEY")).length, 1);
  assert.match(trusted, /name: pstack-verifier/);
  assert.match(policy, /pstack_verifier:[\s\S]*required: false/);
  const required = policy.slice(policy.indexOf("required_checks:"), policy.indexOf("pstack_verifier:"));
  assert.doesNotMatch(required, /pstack-verifier/);
});
