const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { ticks, plan, envFor, TICKS_PER_LINK, MIN_CHECK_MS, PROBE_CHECKS, WATCH_CHECKS } = require("../.github/scripts/production-watch.cjs");

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

test("the drift check and the fixture probe stand down while a prod-health run is in flight, the rest still runs", () => {
  assert.deepEqual(names(plan(0, { fixtureBusy: true })), ["pusher", "api-reachability"]);
  assert.deepEqual(names(plan(3, { fixtureBusy: true })), ["api-reachability"]);
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

  await ticks({ sweeps: 1, execute, sleep: async () => {}, fixtureBusy: async () => { throw new Error("HTTP 502"); } });

  assert.equal(ran.includes("drift"), true);
  assert.equal(ran.includes("core-actions"), true);
});

test("the drift check and the fixture probe are skipped with a notice while a prod-health run is in flight", async () => {
  const { ran, execute } = recorder();
  const messages = [];

  await ticks({ sweeps: 1, execute, sleep: async () => {}, fixtureBusy: async () => true, log: message => messages.push(message) });

  assert.equal(ran.includes("drift"), false);
  assert.equal(ran.includes("core-actions"), false);
  assert.equal(ran.includes("pusher"), true);
  assert.equal(ran.includes("api-reachability"), true);
  assert.match(messages.join("\n"), /this link skips the drift check and the core-actions probe/);
});

test("the core-actions probe and its report carry the health user token, the other checks carry the general one", () => {
  const base = { HYPERTASK_MCP_TOKEN: "general", HYPERTASK_HEALTH_USER_TOKEN: "health" };
  const core = PROBE_CHECKS.find(check => check.name === "core-actions");
  assert.equal(envFor(core, base).HYPERTASK_MCP_TOKEN, "health");
  const reachability = PROBE_CHECKS.find(check => check.name === "api-reachability");
  assert.equal(envFor(reachability, base).HYPERTASK_MCP_TOKEN, "general");
  assert.equal(envFor(core, { HYPERTASK_MCP_TOKEN: "general" }).HYPERTASK_MCP_TOKEN, "general");
});

test("a link that runs out of time stops its ticks instead of running past the deadline", async () => {
  let clock = 0;
  const gaps = [];
  const messages = [];
  const { ran, execute } = recorder();

  const failures = await ticks({
    execute,
    sleep: async ms => { gaps.push(ms); clock += ms; },
    log: message => messages.push(message),
    deadlineMs: 30 * 60 * 1000,
    now: () => clock,
  });

  assert.deepEqual(failures, []);
  assert.equal(gaps.length, 5);
  assert.equal(ran.length, 4 + 5 * 2);
  assert.deepEqual(messages, []);

  const tightClock = { value: 0 };
  const tightGaps = [];
  await ticks({
    execute,
    sleep: async ms => { tightGaps.push(ms); tightClock.value += ms; },
    log: message => messages.push(message),
    deadlineMs: 12 * 60 * 1000,
    now: () => tightClock.value,
  });
  assert.equal(tightGaps.length, 2);
  assert.match(messages.join("\n"), /the link is out of time after 3 ticks/);
});

test("a check near the deadline is given the remaining time, never less than the floor", async () => {
  const seen = [];
  const execute = async (check, options) => {
    seen.push({ check: check.name, timeout: options.timeout });
  };

  await ticks({ sweeps: 1, execute, sleep: async () => {}, deadlineMs: 60 * 1000, now: () => 0 });

  for (const { timeout } of seen) assert.equal(timeout, MIN_CHECK_MS);

  seen.length = 0;
  await ticks({ sweeps: 1, execute, sleep: async () => {}, deadlineMs: null, now: () => 0 });
  for (const { timeout } of seen) assert.equal(timeout, 9 * 60 * 1000);
});

test("the watch workflow runs the tick script and starts the next link even after a red tick", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await readFile(".github/workflows/production-watch.yml", "utf8"));

  assert.deepEqual(workflow.on.schedule, [{ cron: "7-59/30 * * * *" }]);
  assert.equal(workflow.permissions.actions, "write");
  assert.equal(workflow.concurrency.group, "production-watch");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);

  const [pass] = workflow.jobs.watch.steps.filter(step => step.run);
  assert.equal(pass.run, "node .github/scripts/production-watch.cjs --deadline-minutes 34");
  assert.equal(pass.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(pass.env.HYPERTASK_HEALTH_USER_TOKEN, "${{ secrets.HYPERTASK_HEALTH_USER_TOKEN }}");
});

test("the hand-off is its own job, so a watch job killed by its timeout still starts the next link", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await readFile(".github/workflows/production-watch.yml", "utf8"));

  const watch = workflow.jobs.watch;
  const chain = workflow.jobs.chain;
  assert.deepEqual(chain.needs, ["watch"]);
  assert.equal(chain.if, "${{ always() }}");
  assert.equal(chain.permissions.actions, "write");
  assert.ok(watch["timeout-minutes"] > 34);
  assert.ok(chain["timeout-minutes"] >= 30);
  assert.equal(chain.steps.at(-1).run, "node .github/scripts/schedule-chain.cjs hand-off --workflow production-watch.yml --gap-minutes 30");
});

test("the settings monitor starts its next link an hour after this run began", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await readFile(".github/workflows/required-check-settings.yml", "utf8"));

  assert.deepEqual(workflow.on.schedule, [{ cron: "17 * * * *" }]);
  assert.equal(workflow.concurrency, undefined);
  assert.equal(workflow.jobs.verify.concurrency.group, "required-check-settings");
  assert.equal(workflow.jobs.verify.concurrency["cancel-in-progress"], false);
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
