const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const yaml = require("js-yaml");

const workflows = ".github/workflows";
const read = name => yaml.load(readFileSync(`${workflows}/${name}`, "utf8"));

test("the UX chain owns the hourly schedule and the gate keeps only what it does itself", () => {
  const chain = read("ux-signoff-chain.yml");
  const gate = read("ux-signoff-gate.yml");

  assert.equal(chain.on.schedule[0].cron, "29 * * * *");
  assert.deepEqual(Object.keys(chain.on).sort(), ["schedule", "workflow_dispatch"]);
  assert.equal(chain.concurrency.group, "ux-signoff-chain");
  assert.equal(chain.concurrency["cancel-in-progress"], false);
  assert.equal(gate.on.schedule, undefined);
  assert.equal(gate.on.pull_request_target.branches[0], "production");
  assert.ok("workflow_dispatch" in gate.on, "the chain dispatches the gate, so the gate stays dispatchable");
});

test("the wait never shares a group with the gate, so a pull-request reconciliation cannot queue behind it", () => {
  const chain = read("ux-signoff-chain.yml");
  const gate = read("ux-signoff-gate.yml");

  assert.equal(gate.concurrency.group, "ux-signoff-gate");
  assert.equal(gate.concurrency.queue, "max");
  const jobs = Object.values(chain.jobs);
  assert.equal(jobs.length, 1);
  assert.equal(jobs.flatMap(job => Object.values(job.concurrency ?? {})).filter(group => group === "ux-signoff-gate").length, 0);
});

test("a link dispatches the hour when it starts and starts the next link an hour after it began", () => {
  const [job] = Object.values(read("ux-signoff-chain.yml").jobs);
  const steps = job.steps.map(step => step.run).filter(Boolean);

  assert.match(steps[0], /hand-off --workflow ux-signoff-gate\.yml --gap-minutes 0 --chain-events schedule,workflow_dispatch$/);
  assert.match(steps[1], /hand-off --workflow ux-signoff-chain\.yml --gap-minutes 60$/);
  assert.equal(job.steps[0]["continue-on-error"], true, "a refused reconciliation must not cost the chain");
  assert.ok(job.timeout_minutes >= 60 || job["timeout-minutes"] >= 60, "the wait is an hour");
  assert.deepEqual(Object.keys(job.permissions).sort(), ["actions", "contents"]);
});
