const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { ticks, plan, TICKS_PER_LINK, PROBE_CHECKS, WATCH_CHECKS } = require("../.github/scripts/production-watch.cjs");

const names = checks => checks.map(check => check.name);

function recorder({ fail = [], log = () => {} } = {}) {
  const ran = [];
  const execute = async check => {
    ran.push(check.name);
    if (fail.includes(check.name)) throw new Error(`${check.name} exited 1`);
  };
  return { ran, execute, log };
}

test("the first tick of a link runs the thirty-minute half, later ticks only the five-minute pass", () => {
  assert.deepEqual(names(plan(0)), ["drift", "pusher", "api-reachability", "core-actions"]);
  for (const index of [1, 2, 3, 4, 5]) assert.deepEqual(names(plan(index)), ["api-reachability", "core-actions"]);
});

test("the drift check stands down while a prod-health run is in flight, the rest still runs", () => {
  assert.deepEqual(names(plan(0, { driftBlocked: true })), ["pusher", "api-reachability", "core-actions"]);
});

test("one link runs six ticks five minutes apart, in order", async () => {
  const gaps = [];
  const { ran, execute } = recorder();

  const failures = await ticks({ execute, sleep: async ms => gaps.push(ms) });

  assert.deepEqual(failures, []);
  assert.deepEqual(gaps, [300000, 300000, 300000, 300000, 300000]);
  assert.equal(TICKS_PER_LINK, 6);
  assert.deepEqual(ran.slice(0, 4), names(WATCH_CHECKS).concat(names(PROBE_CHECKS)));
  assert.equal(ran.length, 4 + 5 * 2);
});

test("a red check is reported and the rest of the link keeps checking", async () => {
  const { ran, execute } = recorder({ fail: ["api-reachability", "drift"] });

  const failures = await ticks({ sweeps: 2, execute, sleep: async () => {} });

  assert.deepEqual(failures.map(failure => failure.check), ["drift", "api-reachability", "api-reachability"]);
  assert.deepEqual(failures.map(failure => failure.tick), [0, 0, 1]);
  assert.equal(ran.includes("pusher"), true);
  assert.equal(ran.includes("core-actions"), true);
});

test("a failed core-actions probe sends its report before the link moves on", async () => {
  const ran = [];
  const execute = async check => {
    ran.push(check.name);
    if (check.name === "core-actions") throw new Error("core-actions exited 1");
  };

  await ticks({ sweeps: 1, execute, sleep: async () => {} });

  assert.deepEqual(ran, ["drift", "pusher", "api-reachability", "core-actions", "core-actions-report"]);
});

test("a report that cannot go out is a warning, not a lost tick", async () => {
  const messages = [];
  const execute = async check => {
    if (check.name === "core-actions-report") throw new Error("report exited 1");
    if (check.name === "core-actions") throw new Error("core-actions exited 1");
  };

  const failures = await ticks({ sweeps: 1, execute, sleep: async () => {}, log: message => messages.push(message) });

  assert.deepEqual(failures.map(failure => failure.check), ["core-actions"]);
  assert.match(messages.join("\n"), /the core-actions report did not go out: report exited 1/);
});

test("an unreadable prod-health run list never costs the drift check", async () => {
  const { ran, execute } = recorder();

  await ticks({ sweeps: 1, execute, sleep: async () => {}, driftBusy: async () => { throw new Error("HTTP 502"); } });

  assert.equal(ran.includes("drift"), true);
});

test("the drift check is skipped with a notice while a prod-health run is in flight", async () => {
  const { ran, execute } = recorder();
  const messages = [];

  await ticks({ sweeps: 1, execute, sleep: async () => {}, driftBusy: async () => true, log: message => messages.push(message) });

  assert.equal(ran.includes("drift"), false);
  assert.equal(ran.includes("pusher"), true);
  assert.match(messages.join("\n"), /this link skips the drift check/);
});

test("the watch workflow runs the tick script and starts the next link even after a red tick", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await readFile(".github/workflows/production-watch.yml", "utf8"));

  assert.deepEqual(workflow.on.schedule, [{ cron: "7-59/30 * * * *" }]);
  assert.equal(workflow.permissions.actions, "write");
  assert.equal(workflow.concurrency.group, "production-watch");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);

  const [pass, chain] = workflow.jobs.watch.steps.filter(step => step.run);
  assert.equal(pass.run, "node .github/scripts/production-watch.cjs");
  assert.equal(pass.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(chain.if, "${{ always() }}");
  assert.equal(chain.run, "node .github/scripts/schedule-chain.cjs hand-off --workflow production-watch.yml");
});

test("the settings monitor starts its next link an hour after this run began", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await readFile(".github/workflows/required-check-settings.yml", "utf8"));

  assert.deepEqual(workflow.on.schedule, [{ cron: "17 * * * *" }]);
  const chain = workflow.jobs.chain;
  assert.deepEqual(chain.needs, ["verify"]);
  assert.equal(chain.if, "${{ !cancelled() }}");
  assert.equal(chain.permissions.actions, "write");
  assert.equal(chain.concurrency.group, "required-check-settings-chain");
  assert.equal(chain["timeout-minutes"], 75);
  assert.equal(chain.steps.at(-1).run, "node .github/scripts/schedule-chain.cjs hand-off --workflow required-check-settings.yml --gap-minutes 60");
});

test("prod-health keeps every push job and has no cron left to shadow the chain", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await readFile(".github/workflows/prod-health.yml", "utf8"));

  assert.deepEqual(Object.keys(workflow.on), ["push", "workflow_dispatch"]);
  assert.equal(workflow.jobs.health.if, "github.event_name == 'push'");
  assert.equal(workflow.jobs.drift.if, "${{ github.event_name == 'workflow_dispatch' }}");
  assert.equal(workflow.jobs["pusher-status"].if, "${{ github.event_name == 'push' || github.event_name == 'workflow_dispatch' }}");
  assert.match(workflow.jobs["api-reachability"].if, /github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'/);
  assert.doesNotMatch(JSON.stringify(workflow.jobs["core-actions"].if), /schedule/);
});
