const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { ticks, plan, TICKS_PER_LINK, MIN_CHECK_MS, PROBE_CHECKS, WATCH_CHECKS } = require("../.github/scripts/production-watch.cjs");

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
  assert.deepEqual(names(plan(0)), ["drift", "pusher", "api-reachability"]);
  for (const index of [1, 2, 3, 4, 5]) assert.deepEqual(names(plan(index)), ["api-reachability"]);
});

test("the drift check stands down while a prod-health run is in flight, the rest still runs", () => {
  assert.deepEqual(names(plan(0, { fixtureBusy: true })), ["pusher", "api-reachability"]);
  assert.deepEqual(names(plan(3, { fixtureBusy: true })), ["api-reachability"]);
});

test("one link runs six ticks on five-minute boundaries, in order", async () => {
  const gaps = [];
  let clock = 0;
  const { ran, execute } = recorder();

  const failures = await ticks({ execute, now: () => clock, sleep: async ms => { gaps.push(ms); clock += ms; } });

  assert.deepEqual(failures, []);
  assert.deepEqual(gaps, [300000, 300000, 300000, 300000, 300000]);
  assert.equal(TICKS_PER_LINK, 6);
  assert.deepEqual(ran.slice(0, 3), names(WATCH_CHECKS).concat(names(PROBE_CHECKS)));
  assert.equal(ran.length, 3 + 5);
});

test("a red check is reported and the rest of the link keeps checking", async () => {
  const { ran, execute } = recorder({ fail: ["api-reachability", "drift"] });

  const failures = await ticks({ sweeps: 2, execute, sleep: async () => {} });

  assert.deepEqual(failures.map(failure => failure.check), ["drift", "api-reachability", "api-reachability"]);
  assert.deepEqual(failures.map(failure => failure.tick), [0, 0, 1]);
  assert.equal(ran.includes("pusher"), true);
  assert.equal(ran.filter(name => name === "api-reachability").length, 2);
});

test("an unreadable prod-health run list never costs the drift check", async () => {
  const { ran, execute } = recorder();

  await ticks({ sweeps: 1, execute, sleep: async () => {}, fixtureBusy: async () => { throw new Error("HTTP 502"); } });

  assert.equal(ran.includes("drift"), true);
});

test("the drift check is skipped with a notice while a prod-health run is in flight", async () => {
  const { ran, execute } = recorder();
  const messages = [];

  await ticks({ sweeps: 1, execute, sleep: async () => {}, fixtureBusy: async () => true, log: message => messages.push(message) });

  assert.equal(ran.includes("drift"), false);
  assert.equal(ran.includes("pusher"), true);
  assert.equal(ran.includes("api-reachability"), true);
  assert.match(messages.join("\n"), /this tick skips the drift check/);
});

test("the fixture probe is a job that joins the prod-health fixture group instead of a pass", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await readFile(".github/workflows/production-watch.yml", "utf8"));
  const push = yaml.load(await readFile(".github/workflows/prod-health.yml", "utf8"));

  const probe = workflow.jobs["core-actions"];
  assert.equal(probe.concurrency.group, push.jobs["core-actions"].concurrency.group);
  assert.equal(probe.concurrency["cancel-in-progress"], false);
  assert.equal(probe.steps.find(step => step.id === "probe").env.HYPERTASK_MCP_TOKEN, "${{ secrets.HYPERTASK_HEALTH_USER_TOKEN }}");
  assert.equal(names(PROBE_CHECKS).includes("core-actions"), false);
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
  assert.equal(ran.length, 3 + 5);
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

test("a check that no longer fits moves to the next link instead of losing its timeout floor", async () => {
  const seen = [];
  const messages = [];
  const execute = async (check, options) => {
    seen.push({ check: check.name, timeout: options.timeout });
  };

  await ticks({ sweeps: 1, execute, sleep: async () => {}, deadlineMs: 60 * 1000, now: () => 0, log: message => messages.push(message) });

  assert.deepEqual(seen, []);
  assert.match(messages.join("\n"), /drift moved to the next link: fewer than 2 minutes of this link are left/);

  await ticks({ sweeps: 1, execute, sleep: async () => {}, deadlineMs: null, now: () => 0 });
  assert.equal(seen.length, 3);
  for (const { timeout } of seen) assert.equal(timeout, 9 * 60 * 1000);
  assert.equal(MIN_CHECK_MS, 2 * 60 * 1000);
});

test("a slow check shortens the next sleep instead of pushing the tick later", async () => {
  const gaps = [];
  let clock = 0;
  const execute = async () => { clock += 2 * 60 * 1000; };

  await ticks({ sweeps: 2, execute, now: () => clock, sleep: async ms => { gaps.push(ms); clock += ms; } });

  assert.deepEqual(gaps, []);
  assert.equal(clock, 8 * 60 * 1000);
});

test("every tick asks whether a prod-health run is in flight, not just the first", async () => {
  let asked = 0;
  const { ran, execute } = recorder();

  await ticks({ sweeps: 3, execute, sleep: async () => {}, now: () => 0, fixtureBusy: async () => { asked += 1; return false; } });

  assert.equal(asked, 3);
  assert.equal(ran.filter(name => name === "api-reachability").length, 3);
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
