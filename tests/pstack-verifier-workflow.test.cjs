const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const read = (file) => readFileSync(join(__dirname, "..", file), "utf8");

test("the boot holds for the verifier and the job strips the model key before containers start", () => {
  const isolated = read("scripts/run-app-smoke-isolated.sh");
  const hold = isolated.indexOf("PSTACK_VERIFIER_HOLD:-");
  const harness = isolated.indexOf("run-shared-core-actions-smoke.mjs");
  assert.ok(hold > 0 && hold < harness);
  assert.match(isolated, /127\.0\.0\.1:3100:3100/);
  const job = read("scripts/pstack-verifier-job.sh");
  const unsetAt = job.indexOf("unset OPENROUTER_EVAL_KEY OPENCODE_API_KEY");
  const bootAt = job.indexOf("run-app-smoke-isolated.sh");
  const driveAt = job.indexOf('pstack-verifier.mjs" drive');
  assert.ok(unsetAt > 0 && unsetAt < bootAt && bootAt < driveAt);
  assert.doesNotMatch(job, /OPENROUTER_EVAL_KEY="\$key"/);
  assert.match(job, /env -u OPENROUTER_EVAL_KEY -u OPENCODE_API_KEY -u GH_TOKEN -u GITHUB_TOKEN/);
});

test("pstack-verifier posts FAIL on a crash, a timeout, and a failed request", () => {
  const request = read(".github/workflows/pstack-verifier-request.yml");
  const trusted = read(".github/workflows/pstack-verifier.yml");
  const policy = read("docs/ci-policy.yml");
  const script = read("scripts/pstack-verifier.mjs");
  assert.match(request, /permissions: \{\}/);
  assert.doesNotMatch(request, /secrets\./);
  assert.match(trusted, /workflows: \["Pstack Verifier Request"\]/);
  assert.doesNotMatch(trusted, /pull_request:|resolve\.outcome/);
  assert.equal(trusted.match(/persist-credentials: false/g).length, 2);
  assert.match(trusted, /path: candidate/);
  assert.match(trusted, /ref: \$\{\{ github\.sha \}\}/);
  assert.equal(trusted.split("\n").filter((line) => line.includes("OPENROUTER_EVAL_KEY")).length, 1);
  assert.match(trusted, /name: pstack-verifier/);
  assert.match(trusted, /outputs\.rev \|\| github\.event\.workflow_run\.head_sha/);
  const block = (id) => { const lines = trusted.split("\n"); const start = lines.findIndex((line) => line === `  ${id}:`); let end = lines.findIndex((line, index) => index > start && /^  [a-z0-9-]+:$/.test(line)); return lines.slice(start, end < 0 ? lines.length : end).join("\n"); };
  const drive = block("drive"), post = block("post"), model = block("model");
  assert.match(drive, /permissions: \{ contents: read, packages: read, actions: read \}/);
  assert.match(drive, /ref: \$\{\{ needs\.resolve\.outputs\.rev \}\}/);
  assert.doesNotMatch(drive, /write|secrets\./);
  assert.match(post, /<<: \*trusted/);
  assert.doesNotMatch(post, /ref: \$\{\{ needs\.resolve\.outputs\.rev \}\}|path: candidate/);
  assert.match(model, /<<: \*trusted[\s\S]*secrets\.OPENROUTER_EVAL_KEY/);
  assert.doesNotMatch(model, /path: candidate|outputs\.rev/);
  assert.match(script, /process\.exitCode = 2/);
  const postAt = trusted.indexOf("pstack-verifier.mjs post && exit 0 || code=$?");
  const cancelAt = trusted.indexOf("  pstack-verifier-cancel:");
  assert.ok(postAt > 0 && cancelAt > postAt);
  assert.match(trusted.slice(postAt, cancelAt), /state=failure/);
  assert.match(trusted.slice(postAt, cancelAt), /The verifier did not finish/);
  assert.match(trusted.slice(cancelAt), /result != 'success'[\s\S]*timeout-minutes: 10[\s\S]*\[ "\$state" = "success" \] \|\| \[ "\$state" = "failure" \][\s\S]*state=failure/);
  assert.doesNotMatch(trusted.slice(cancelAt), /result == 'cancelled'/);
  assert.match(policy, /pstack_verifier:[\s\S]*required: false[\s\S]*Candidate page script runs in the unprivileged drive job browser/);
  const required = policy.slice(policy.indexOf("required_checks:"), policy.indexOf("pstack_verifier:"));
  assert.doesNotMatch(required, /pstack-verifier/);
});
