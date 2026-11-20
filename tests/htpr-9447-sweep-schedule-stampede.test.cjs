const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

function fakeRedis() {
  const store = new Map();
  return {
    store,
    async set(key, value, ...flags) {
      const upper = flags.map((flag) => String(flag).toUpperCase());
      if (upper.includes("NX") && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
  };
}

function rateLimitedQstash({ burst = 120 } = {}) {
  const calls = [];
  async function create(schedule) {
    calls.push(schedule);
    if (calls.length > burst) {
      throw Object.assign(new Error("Exceeded burst rate limit."), {
        name: "QstashRatelimitError",
        status: 429,
      });
    }
    return { scheduleId: schedule.scheduleId };
  }
  return { calls, create };
}

function boot(t, { create, redis }) {
  const values = {
    NEXT_RUNTIME: "nodejs",
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    QSTASH_AUTO_REGISTER_SWEEP: undefined,
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
  t.mock.method(console, "error", (...args) => errors.push(args[0]));
  const { register } = load("src/instrumentation.ts", {
    "@/lib/qstash": {
      qstashCallbackBase: () => "https://app.example.test",
      getQstashClient: () => ({ schedules: { create } }),
    },
    "@/lib/redis": { getRedis: async () => redis },
  });
  return { register, errors };
}

test("300 concurrent instance boots create the sweep schedule once", async (t) => {
  const qstash = rateLimitedQstash();
  const { register, errors } = boot(t, { create: qstash.create, redis: fakeRedis() });

  await Promise.all(Array.from({ length: 300 }, () => register()));

  assert.deepEqual(errors, []);
  assert.equal(qstash.calls.length, 1);
});

test("a rate-limited registration is attempted once per window and reported once", async (t) => {
  let attempts = 0;
  const create = async () => {
    attempts++;
    throw Object.assign(new Error("Exceeded burst rate limit."), { status: 429 });
  };
  const { register, errors } = boot(t, { create, redis: fakeRedis() });

  await Promise.all(Array.from({ length: 50 }, () => register()));

  assert.equal(attempts, 1);
  assert.equal(errors.length, 1);
});

test("a failed registration frees the window so a later boot registers", async (t) => {
  const schedules = [];
  let healthy = false;
  const create = async (schedule) => {
    if (!healthy) throw new Error("QStash schedule request failed with status 503");
    schedules.push(schedule);
    return { scheduleId: schedule.scheduleId };
  };
  const { register, errors } = boot(t, { create, redis: fakeRedis() });

  await register();
  healthy = true;
  await register();

  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].destination, "https://app.example.test/api/queues/sweep");
  assert.equal(errors.length, 1);
});
