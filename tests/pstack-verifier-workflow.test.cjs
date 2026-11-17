const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const yaml = require("js-yaml");

const read = (file) => yaml.load(readFileSync(file, "utf8"), { schema: yaml.JSON_SCHEMA });
const trusted = read(".github/workflows/pstack-verifier.yml");
const request = read(".github/workflows/pstack-verifier-request.yml");
const policy = read("docs/ci-policy.yml");
const expected = {
  resolve: { contents: "read", "pull-requests": "read", statuses: "write" },
  plan: { contents: "read" },
  drive: { contents: "read", packages: "read" },
  judge: { contents: "read" },
  post: { contents: "read", "pull-requests": "write", statuses: "write" },
  cancel: { statuses: "write" },
};

function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => strings(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => strings(item, out));
  return out;
}
const needs = (job) => [].concat(job.needs ?? []);
function tokenGaps(jobs) {
  const gaps = [];
  for (const [name, job] of Object.entries(jobs)) {
    for (const [index, step] of (job.steps ?? []).entries()) {
      const run = String(step.run ?? "");
      const usesGithub = /\bgh\b|docker login|pstack-verifier\.mjs\s+(?:resolve|plan|judge|post)/.test(run);
      if (usesGithub && step.env?.GH_TOKEN !== "${{ github.token }}") gaps.push(`${name}:${index}`);
    }
  }
  return gaps;
}

test("each verifier job has the declared permissions, key and token", () => {
  assert.deepEqual(request.permissions, {});
  assert.deepEqual(trusted.permissions, {});
  for (const [name, permissions] of Object.entries(expected)) assert.deepEqual(trusted.jobs[name].permissions, permissions, name);
  assert.deepEqual(needs(trusted.jobs.plan), ["resolve"]);
  assert.deepEqual(needs(trusted.jobs.drive), ["resolve", "plan"]);
  assert.deepEqual(needs(trusted.jobs.judge), ["resolve", "plan", "drive"]);
  assert.deepEqual(needs(trusted.jobs.post), ["resolve", "judge"]);
  assert.deepEqual(needs(trusted.jobs.cancel), ["resolve", "post"]);
  const secretJobs = Object.entries(trusted.jobs).filter(([, job]) => strings(job).some((value) => value.includes("secrets."))).map(([name]) => name);
  assert.deepEqual(secretJobs, ["plan", "judge"]);
  assert.equal(strings(trusted.jobs.drive).some((value) => value.includes("secrets.") || value.includes("OPENROUTER_EVAL_KEY")), false);
  assert.deepEqual(tokenGaps(trusted.jobs), []);
  assert.equal(trusted.jobs.cancel.steps.some((step) => String(step.uses ?? "").includes("checkout")), false);
  const names = [];
  for (const job of Object.values(trusted.jobs)) {
    for (const step of job.steps ?? []) {
      const uses = String(step.uses ?? "");
      if (step.with?.name) names.push(step.with.name);
      if (uses.includes("artifact")) assert.ok(uses.startsWith("actions/upload-artifact@") || uses.startsWith("actions/download-artifact@"));
      assert.equal(String(step.run ?? "").includes("@actions/artifact"), false);
    }
  }
  assert.deepEqual(names.filter((name) => !name.includes("${{ github.run_id }}-${{ github.run_attempt }}")), []);
  assert.equal(policy.pstack_verifier.required, false);
  assert.equal(policy.pstack_verifier.note, "enable after hosted proof");
  assert.equal(policy.required_checks.contexts.includes("pstack-verifier"), false);
  for (const name of ["post", "cancel"]) { assert.equal(trusted.jobs[name].if.includes("always()"), false); assert.match(trusted.jobs[name].if, /!cancelled\(\)/); }
});
