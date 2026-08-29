const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/stripe-checkout-reservation-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);
const loadTs = (relativePath) => jiti(path.join(root, relativePath));

function memoryRedis() {
  const values = new Map();
  return {
    values,
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value, ...options) {
      if (options.includes("NX") && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    async eval(script, keyCount, ...args) {
      const keys = args.slice(0, keyCount);
      const argv = args.slice(keyCount);
      const lockMatches = values.get(keys[0]) === argv[0];

      if (script.includes("pexpire")) return lockMatches ? 1 : 0;
      if (script.includes("KEYS[2]") && script.includes("redis.call('set'")) {
        if (!lockMatches) return 0;
        values.set(keys[1], argv[1]);
        return 1;
      }
      if (script.includes("KEYS[2]") && script.includes("redis.call('del'")) {
        if (!lockMatches) return -1;
        return values.delete(keys[1]) ? 1 : 0;
      }
      if (script.includes("redis.call('del'")) {
        if (!lockMatches) return 0;
        return values.delete(keys[0]) ? 1 : 0;
      }
      throw new Error("Unexpected Redis script");
    },
  };
}

const redis = memoryRedis();
const redisModule = loadTs("src/lib/redis.ts");
redisModule.getRedis = async () => redis;
const reservation = loadTs(
  "src/utils/controllers/stripe/checkoutReservation.ts",
);

const desired = {
  cancelUrl: "https://app.hypertask.ai/pricing?success=0",
  checkoutMode: "Normal",
  customerId: "cus_owned",
  googleAccountId: "account-owned",
  priceId: "price_pro_month",
  quantity: 7,
  returnUrl: "https://app.hypertask.ai/confirmation",
  teamId: "team-owned",
};
const teamLockKey = `stripe:checkout:lock:${createHash("sha256")
  .update("team-owned")
  .digest("hex")}`;

test("checkout attempts use unique attempt-scoped idempotency keys", () => {
  const first = reservation.createCheckoutAttempt(desired);
  const second = reservation.createCheckoutAttempt(desired);

  assert.notEqual(first.attemptId, second.attemptId);
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
  assert.equal(first.state, "prepared");
  assert.equal(second.state, "prepared");
  assert.match(first.idempotencyKey, /^team-checkout:team-owned:[0-9a-f-]+$/);
});

test("the token-owned lock serializes and persists one checkout reservation", async () => {
  redis.values.clear();
  const order = [];
  let releaseFirst;
  const firstMayFinish = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const attempt = reservation.createCheckoutAttempt(desired);

  const first = reservation.withTeamCheckoutReservation(
    "team-owned",
    async (context) => {
      order.push("first-start");
      await context.write(attempt);
      await firstMayFinish;
      order.push("first-end");
    },
  );
  const second = reservation.withTeamCheckoutReservation(
    "team-owned",
    async (context) => {
      order.push("second-start");
      assert.deepEqual(await context.read(), attempt);
      await context.clear();
      order.push("second-end");
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, ["first-start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, [
    "first-start",
    "first-end",
    "second-start",
    "second-end",
  ]);
});

test("reservation writes fail closed if the lock token is replaced", async () => {
  redis.values.clear();
  const attempt = reservation.createCheckoutAttempt(desired);

  await assert.rejects(
    reservation.withTeamCheckoutReservation("team-owned", async (context) => {
      redis.values.set(teamLockKey, "other-owner");
      await context.write(attempt);
    }),
    (error) => error.name === "CheckoutReservationLockLostError",
  );

  assert.equal(redis.values.get(teamLockKey), "other-owner");
});
