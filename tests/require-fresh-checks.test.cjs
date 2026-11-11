const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const live = {
  name: "production-required-checks",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["refs/heads/production"], exclude: [] } },
  rules: [
    { type: "deletion", parameters: { blocked: true } },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: [
          { context: "ci-tests", integration_id: 15368 },
          { context: "premerge-evidence" },
        ],
      },
    },
  ],
};

test("a stale ruleset becomes strict and keeps every other protection", async () => {
  const { checkPins, checksAreFresh, planFreshChecks, requireFreshChecks } = await import("../.github/scripts/require-fresh-checks.mjs");
  assert.equal(checksAreFresh(live), false);
  const plan = planFreshChecks(live);
  assert.equal(plan.action, "put");
  assert.equal(live.rules[1].parameters.strict_required_status_checks_policy, false);
  const body = plan.body;
  assert.equal(body.rules[0].type, "deletion");
  assert.deepEqual(body.rules[0].parameters, { blocked: true });
  assert.equal(body.rules[1].parameters.strict_required_status_checks_policy, true);
  assert.equal(body.rules[1].parameters.do_not_enforce_on_create, false);
  assert.deepEqual(body.rules[1].parameters.required_status_checks, live.rules[1].parameters.required_status_checks);
  assert.equal(Object.prototype.hasOwnProperty.call(body.rules[1].parameters.required_status_checks[1], "integration_id"), false);
  assert.deepEqual(checkPins(body), checkPins(live));
  assert.equal(checksAreFresh(body), true);
  assert.deepEqual(body.bypass_actors, []);
  assert.equal(planFreshChecks({ ...live, rules: [{ ...live.rules[1], parameters: { ...live.rules[1].parameters, strict_required_status_checks_policy: true } }] }).action, "noop");
  assert.throws(() => requireFreshChecks({ ...live, name: "other" }), /production-required-checks/);
  assert.throws(() => requireFreshChecks({
    ...live,
    rules: [live.rules[0], {
      ...live.rules[1],
      parameters: { ...live.rules[1].parameters, do_not_enforce_on_create: true },
    }],
  }), /create enforcement/);
  assert.throws(() => requireFreshChecks({
    ...live,
    rules: [{
      ...live.rules[1],
      parameters: { ...live.rules[1].parameters, required_status_checks: [] },
    }],
  }), /empty required-check list/);
  console.log("FRESH_CHECKS_PRESERVED");
});

test("the production job is the only writer and it refuses a casual run", () => {
  const workflow = readFileSync(".github/workflows/require-fresh-checks.yml", "utf8");
  const script = readFileSync(".github/scripts/require-fresh-checks.mjs", "utf8");
  assert.equal(workflow.split("administration: write").length, 2);
  assert.match(workflow, /permissions:\n {2}contents: read\n/);
  assert.match(workflow, /branches: \[production\]/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/production'/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /timeout-minutes: 10/);
  assert.match(workflow, /APPLY_FRESH_CHECKS: "1"/);
  assert.match(workflow, /node \.github\/scripts\/require-fresh-checks\.mjs\n/);
  assert.doesNotMatch(workflow, /pull_request/);
  assert.match(script, /APPLY_FRESH_CHECKS !== "1"/);
  assert.match(script, /integration_id !== 15368/);
});
