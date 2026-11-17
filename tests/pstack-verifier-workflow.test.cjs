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
  judge: { contents: "read", checks: "read", statuses: "read" },
  post: { actions: "read", contents: "read", "pull-requests": "write", statuses: "write" },
  cancel: { statuses: "write" },
};

function runParts(step) {
  return String(step?.run ?? "").split("&&").map((part) => part.trim()).filter((part) => part.length > 0);
}

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

test("drive generates the database client before the drive script runs", () => {
  const steps = trusted.jobs.drive.steps;
  const generateAt = steps.findIndex((step) => runParts(step).some((part) => part.split(" ").includes("prisma") && part.split(" ").includes("generate")));
  const driveAt = steps.findIndex((step) => runParts(step).some((part) => part.includes("pstack-verifier-job.sh")));
  assert.equal(generateAt >= 0, true);
  assert.equal(driveAt >= 0, true);
  assert.equal(generateAt < driveAt, true);
});

test("each verifier job has the declared permissions, key and token", async () => {
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
  const { CI_WAIT_ROUNDS, CI_WAIT_INTERVAL_MS, REQUIRED_CI_CONTEXTS } = await import("../scripts/pstack-verifier.mjs");
  assert.equal(trusted.jobs.judge["timeout-minutes"] * 60 * 1000 > CI_WAIT_ROUNDS * CI_WAIT_INTERVAL_MS, true);
  const liveRulesetContexts = [
    "app-smoke", "browser-smoke", "ci-tests", "ai-review", "claude-review",
    "feature-flag-gate", "pr-title", "next-public-secrets", "secret-scan",
  ];
  assert.deepEqual([...REQUIRED_CI_CONTEXTS].sort(), [...liveRulesetContexts].sort());
});
