const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

function startup(t, create, overrides = {}) {
  const values = {
    NEXT_RUNTIME: "nodejs",
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    QSTASH_AUTO_REGISTER_SWEEP: undefined,
    QSTASH_SWEEP_SCHEDULE_ID: undefined,
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  t.mock.method(console, "info", () => {});
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  const { register } = load("src/instrumentation.ts", {
    "@/lib/qstash": {
      qstashCallbackBase: () => "https://app.example.test",
      getQstashClient: () => ({ schedules: { create } }),
    },
  });
  return { register, errors };
}

test("QStash 503 is reported without failing Next startup; a later startup still registers", async (t) => {
  const unavailable = new Error("QStash schedule request failed with status 503");
  const schedules = [];
  let healthy = false;
  const { register, errors } = startup(t, async (schedule) => {
    if (!healthy) throw unavailable;
    schedules.push(schedule);
    return { scheduleId: schedule.scheduleId };
  });
  await register();
  assert.deepEqual(errors, [["[instrumentation] sweep schedule registration failed", unavailable]]);
  healthy = true;
  await register();
  assert.deepEqual(schedules, [{
    scheduleId: "hypertask-sweep-v1",
    destination: "https://app.example.test/api/queues/sweep",
    cron: "* * * * *",
    headers: { "Content-Type": "application/json" },
    body: '{"schedule":"hypertask-sweep-v1"}',
  }]);
  assert.equal(errors.length, 1);
});

test("successful production startup preserves the sweep schedule without error reports", async (t) => {
  const schedules = [];
  const { register, errors } = startup(t, async (schedule) => {
    schedules.push(schedule);
    return { scheduleId: schedule.scheduleId };
  });
  await register();
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].destination, "https://app.example.test/api/queues/sweep");
  assert.deepEqual(errors, []);
});

for (const overrides of [
  { NEXT_RUNTIME: "edge" },
  { VERCEL_ENV: "preview" },
  { QSTASH_AUTO_REGISTER_SWEEP: "false" },
  { NODE_ENV: "development" },
]) {
  test(`startup still skips scheduling for ${JSON.stringify(overrides)}`, async (t) => {
    let attempts = 0;
    const { register, errors } = startup(t, async (schedule) => {
      attempts++;
      return { scheduleId: schedule.scheduleId };
    }, overrides);
    await register();
    assert.equal(attempts, 0);
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.QSTASH_AUTO_REGISTER_SWEEP = "true";
    await register();
    assert.equal(attempts, 1);
    assert.deepEqual(errors, []);
  });
}
