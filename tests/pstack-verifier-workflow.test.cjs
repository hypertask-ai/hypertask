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
  post: { contents: "read", "pull-requests": "write", statuses: "write" },
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
  assert.equal(policy.pstack_verifier.required, true);
  assert.equal(policy.pstack_verifier.note, "https://app.hypertask.ai/detail/project-15/9411");
  assert.equal(policy.required_checks.contexts.includes("pstack-verifier"), true);
  for (const name of ["post", "cancel"]) { assert.equal(trusted.jobs[name].if.includes("always()"), false); assert.match(trusted.jobs[name].if, /!cancelled\(\)/); }
  const { CI_WAIT_ROUNDS, CI_WAIT_INTERVAL_MS, REQUIRED_CI_CONTEXTS } = await import("../scripts/pstack-verifier.mjs");
  assert.equal(trusted.jobs.judge["timeout-minutes"] * 60 * 1000 > CI_WAIT_ROUNDS * CI_WAIT_INTERVAL_MS, true);
  assert.equal(REQUIRED_CI_CONTEXTS.includes("pstack-verifier"), false);
  assert.deepEqual([...policy.policies.production_ruleset.required_status_checks].sort(), [...REQUIRED_CI_CONTEXTS, "pstack-verifier"].sort());
  assert.equal(policy.required_checks.automerge_also_requires.includes("pstack-verifier"), true);
  const cancel = trusted.jobs.cancel.steps.map((step) => String(step.run ?? "")).join("\n");
  const guardAt = cancel.indexOf("waiting for required checks");
  const failureAt = cancel.indexOf("state=failure");
  assert.equal(guardAt >= 0 && failureAt > guardAt, true);
});

test("recheck waits on production, reruns only a verifier wait, and pages past a full run list", async () => {
  const recheck = read(".github/workflows/pstack-verifier-recheck.yml");
  const automerge = readFileSync(".github/workflows/automerge.yml", "utf8");
  assert.match(automerge, /REQUIRED="\$REQUIRED pstack-verifier"/);
  assert.deepEqual(recheck.on.workflow_run.workflows, ["CI Tests", "PR Guards"]);
  assert.equal(recheck.on.workflow_run.workflows.includes("Pstack Verifier Request"), false);
  assert.deepEqual(recheck.jobs.recheck.permissions, { contents: "read", "pull-requests": "read", statuses: "read", actions: "write" });
  assert.equal(recheck.jobs.chain.permissions.actions, "write");
  assert.equal(recheck.jobs.chain.permissions.statuses, undefined);
  assert.match(recheck.jobs.chain.steps.at(-1).run, /--chain-events workflow_dispatch/);
  assert.match(recheck.jobs.chain.steps.at(-1).run, /--gap-minutes 30/);
  const enabled = (expr, env) => Function(`return (${expr
    .replaceAll("!cancelled()", "true")
    .replaceAll("github.event.workflow_run.event", JSON.stringify(env.workflowRunEvent ?? ""))
    .replaceAll("github.event_name", JSON.stringify(env.eventName))
    .replaceAll("github.ref", JSON.stringify(env.ref ?? ""))
    .replaceAll("==", "===")});`)();
  for (const job of Object.values(recheck.jobs)) assert.equal(enabled(job.if, { eventName: "workflow_dispatch", ref: "refs/heads/feature" }), false);
  assert.equal(enabled(recheck.jobs.recheck.if, { eventName: "workflow_dispatch", ref: "refs/heads/production" }), true);
  assert.equal(enabled(recheck.jobs.chain.if, { eventName: "workflow_run", workflowRunEvent: "pull_request" }), false);
  const helper = await import("../.github/scripts/pstack-verifier-recheck.mjs");
  assert.equal(helper.sourceStartsRecheck("Pstack Verifier Request"), false);
  assert.equal(helper.shouldRerun({ context: "pstack-verifier", state: "pending", description: "Planning a user check" }, { name: "Pstack Verifier Request", path: ".github/workflows/pstack-verifier-request.yml" }), false);
  assert.equal(helper.shouldRerun({ context: "pstack-verifier", state: "pending", description: "waiting for required checks" }, { path: ".github/workflows/pstack-verifier.yml" }), true);
  assert.equal(helper.workflowRunSha({ workflow_run: { name: "Pstack Verifier Request", event: "pull_request", head_sha: "a".repeat(40) } }), "");
  const oldest = "2026-11-17T01:00:00Z";
  const items = Array.from({ length: 31 }, (_, index) => ({ number: index + 1, waitingSince: index === 30 ? oldest : new Date(Date.parse("2026-11-17T02:00:00Z") + index * 1000).toISOString() }));
  assert.equal(helper.selectReruns(items)[0].number, 31);
  assert.equal(helper.selectReruns(items).length, 10);
  assert.equal(helper.selectReruns(items)[0].number, 31);
  const pulls = await helper.listProductionPulls(async (page) => page === 1
    ? Array.from({ length: 100 }, (_, index) => ({ number: index + 1, state: "open", draft: false, base: { ref: "production" } }))
    : [{ number: 131, state: "open", draft: false, base: { ref: "production" } }]);
  assert.equal(pulls.length, 101);
  assert.equal(pulls.at(-1).number, 131);
  const { runInFlight, standDown, handOff } = require("../.github/scripts/schedule-chain.cjs");
  const page = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, status: "in_progress", event: "workflow_run" }));
  const api = async (path, method = "GET") => {
    if (method === "POST") return {};
    if (path.endsWith("per_page=30")) return { workflow_runs: page };
    if (path.includes("page=2")) return { workflow_runs: [{ id: 99, status: "in_progress", event: "workflow_dispatch" }] };
    return { workflow_runs: [] };
  };
  assert.equal((await runInFlight("hypertask-ai/hypertask", "pstack-verifier-recheck.yml", null, api, ["workflow_dispatch"])).id, 99);
  assert.equal((await standDown("hypertask-ai/hypertask", { workflowFile: "pstack-verifier-recheck.yml", api, chainEvents: ["workflow_dispatch"] })).id, 99);
  assert.equal(await standDown("hypertask-ai/hypertask", { workflowFile: "pstack-verifier-recheck.yml", api: async () => ({ workflow_runs: [] }), chainEvents: ["workflow_dispatch"] }), null);
  assert.equal((await handOff("hypertask-ai/hypertask", { workflowFile: "pstack-verifier-recheck.yml", api: async (path, method) => method === "POST" ? {} : { workflow_runs: [] }, chainEvents: ["workflow_dispatch"] })).dispatched, true);
});
