const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  BoardMemoryRateLimitError,
  BoardMemoryBusyError,
  bumpBoardMemoryRevision,
  claimBoardMemorySignal,
  completeBoardMemorySignalClaim,
  getBoardMemoryRevision,
  withBoardMemoryLock,
} = jiti(path.join(root, "src/app/api/ai/_lib/boardMemoryGuards.ts"));

function createRedis({
  counts = [],
  expireErrors = [],
  expireResults = [],
  revision = 0,
  setResults = [],
} = {}) {
  const calls = [];
  const values = new Map();
  return {
    calls,
    forceSet(key, value) {
      values.set(key, value);
    },
    value(key) {
      return values.get(key);
    },
    async del(key) {
      calls.push(["del", key]);
      return values.delete(key) ? 1 : 0;
    },
    eval: async (script, keyCount, key, token, ...args) => {
      calls.push(["eval", script, keyCount, key, token, ...args]);
      if (values.get(key) !== token) return 0;
      if (script.includes("'complete'")) {
        values.set(key, "complete");
        return 1;
      }
      if (script.includes("expire")) return 1;
      if (script.includes("del")) values.delete(key);
      return 1;
    },
    multi() {
      const commands = [];
      return {
        incr(key) {
          commands.push(["incr", key]);
          return this;
        },
        expire(key, seconds) {
          commands.push(["expire", key, seconds]);
          return this;
        },
        async exec() {
          calls.push(...commands);
          return [
            [null, counts.shift() ?? 1],
            [expireErrors.shift() ?? null, expireResults.shift() ?? 1],
          ];
        },
      };
    },
    async get(key) {
      calls.push(["get", key]);
      if (key.startsWith("ai:board-memory:revision:")) {
        return revision === 0 ? null : String(revision);
      }
      return values.get(key) ?? null;
    },
    async incr(key) {
      calls.push(["incr", key]);
      revision += 1;
      return revision;
    },
    async set(key, value, ...args) {
      calls.push(["set", key, value, ...args]);
      if (setResults.length > 0) {
        const result = setResults.shift();
        if (result === "OK") values.set(key, value);
        return result;
      }
      if (args.includes("NX") && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
  };
}

const signal = {
  type: "edited_ai_title",
  originalText: "Customer import",
  correctedText: "Member import",
};

test("board memory skips duplicate signals before consuming inference budget", async () => {
  const redis = createRedis();

  const first = await claimBoardMemorySignal(
    { projectId: 15, signal, userId: 6 },
    async () => redis,
  );
  await completeBoardMemorySignalClaim(
    { projectId: 15, signal, userId: 6 },
    first.token,
    async () => redis,
  );

  const second = await claimBoardMemorySignal(
    { projectId: 15, signal, userId: 6 },
    async () => redis,
  );

  assert.equal(first.status, "claimed");
  assert.deepEqual(second, { status: "duplicate" });
  const setCalls = redis.calls.filter((call) => call[0] === "set");
  assert.equal(setCalls.length, 2);
  assert.match(setCalls[0][1], /^ai:board-memory:signal:15:6:/);
  assert.doesNotMatch(setCalls[0][1], /Customer|Member/);
  assert.deepEqual(setCalls[0].slice(-3), ["EX", 65, "NX"]);
  const completionCall = redis.calls.find(
    (call) => call[0] === "eval" && call[1].includes("'complete'"),
  );
  assert.deepEqual(completionCall.slice(-2), [first.token, 300]);
});

test("board memory reports an in-flight signal as retryable", async () => {
  const redis = createRedis();
  const first = await claimBoardMemorySignal(
    { projectId: 15, signal, userId: 6 },
    async () => redis,
  );

  await assert.rejects(
    claimBoardMemorySignal(
      { projectId: 15, signal, userId: 6 },
      async () => redis,
    ),
    (error) =>
      error instanceof BoardMemoryBusyError && error.retryAfterSeconds === 5,
  );
  assert.equal(redis.value(redis.calls[0][1]), first.token);
});

test("board memory limits each user and board to ten new signals per minute", async () => {
  const redis = createRedis({ counts: [10, 11] });

  const tenth = await claimBoardMemorySignal(
    { projectId: 15, signal, userId: 6 },
    async () => redis,
  );
  assert.equal(tenth.status, "claimed");

  await assert.rejects(
    claimBoardMemorySignal(
      {
        projectId: 15,
        signal: { ...signal, correctedText: "Member imports" },
        userId: 6,
      },
      async () => redis,
    ),
    (error) =>
      error instanceof BoardMemoryRateLimitError && error.retryAfterSeconds > 0,
  );
  assert.equal(redis.calls.at(-1)[0], "eval");
});

test("board memory rate limits are isolated by user and board", async () => {
  const redis = createRedis({ counts: [1, 1, 1] });

  await claimBoardMemorySignal(
    { projectId: 15, signal, userId: 6 },
    async () => redis,
  );
  await claimBoardMemorySignal(
    { projectId: 16, signal, userId: 6 },
    async () => redis,
  );
  await claimBoardMemorySignal(
    { projectId: 15, signal, userId: 7 },
    async () => redis,
  );

  const rateKeys = redis.calls
    .filter((call) => call[0] === "incr" && call[1].includes(":rate:"))
    .map((call) => call[1].replace(/:\d+$/, ":window"));
  assert.deepEqual(rateKeys, [
    "ai:board-memory:rate:15:6:window",
    "ai:board-memory:rate:16:6:window",
    "ai:board-memory:rate:15:7:window",
  ]);
});

test("board memory releases a signal when rate-key expiry fails", async () => {
  const redis = createRedis({ expireResults: [0] });

  await assert.rejects(
    claimBoardMemorySignal(
      { projectId: 15, signal, userId: 6 },
      async () => redis,
    ),
    /expiry failed/,
  );

  assert.equal(redis.calls.at(-1)[0], "eval");
});

test("board memory revisions advance when a user mutates memory", async () => {
  const redis = createRedis({ revision: 4 });

  assert.equal(await getBoardMemoryRevision(15, async () => redis), 4);
  assert.equal(await bumpBoardMemoryRevision(15, async () => redis), 5);
  assert.match(redis.calls[0][1], /^ai:board-memory:revision:15$/);
});

test("board memory lock reports contention without running or claiming work", async () => {
  const busyRedis = createRedis({
    setResults: Array.from({ length: 20 }, () => null),
  });
  let handled = false;
  await assert.rejects(
    withBoardMemoryLock(
      15,
      async () => {
        handled = true;
        return "written";
      },
      async () => busyRedis,
      async () => undefined,
    ),
    BoardMemoryBusyError,
  );
  assert.equal(handled, false);
});

test("board memory lock releases only its current owner", async () => {
  const availableRedis = createRedis();
  let lockKey;
  const written = await withBoardMemoryLock(
    15,
    async () => {
      const lockCall = availableRedis.calls.find(
        (call) => call[0] === "set" && call[1].includes(":lock:"),
      );
      lockKey = lockCall[1];
      availableRedis.forceSet(lockKey, "new-owner");
      return "written";
    },
    async () => availableRedis,
  );
  assert.equal(written, "written");
  assert.equal(availableRedis.calls.at(-1)[0], "eval");
  assert.equal(availableRedis.value(lockKey), "new-owner");
});

test("board memory lock lease outlives the route execution limit", async () => {
  const redis = createRedis();

  const written = await withBoardMemoryLock(
    15,
    async () => "written",
    async () => redis,
  );

  assert.equal(written, "written");
  const lockCall = redis.calls.find(
    (call) => call[0] === "set" && call[1].includes(":lock:"),
  );
  assert.deepEqual(lockCall.slice(-3), ["EX", 300, "NX"]);
});

test("board memory lock fences a mutation after lease loss", async () => {
  const redis = createRedis();
  let lockKey;

  await assert.rejects(
    withBoardMemoryLock(
      15,
      async (lease) => {
        const lockCall = redis.calls.find(
          (call) => call[0] === "set" && call[1].includes(":lock:"),
        );
        lockKey = lockCall[1];
        redis.forceSet(lockKey, "new-owner");
        await lease.assertCurrent();
        return "written";
      },
      async () => redis,
      async () => undefined,
    ),
    BoardMemoryBusyError,
  );

  assert.equal(redis.value(lockKey), "new-owner");
});
