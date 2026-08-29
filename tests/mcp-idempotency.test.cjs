const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

const redisModulePath = path.join(root, "src/lib/redis.ts");
const storeModulePath = path.join(
  root,
  "src/lib/mcp/idempotency/idempotencyStore.ts",
);

function loadStore(getRedis) {
  delete require.cache[redisModulePath];
  delete require.cache[storeModulePath];

  require.cache[redisModulePath] = {
    id: redisModulePath,
    filename: redisModulePath,
    loaded: true,
    exports: { getRedis },
  };

  const jiti = require("jiti")(
    path.join(root, `tests/mcp-idempotency-jiti-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );

  return jiti(storeModulePath);
}

test("normalizes idempotency keys", () => {
  const { normalizeIdempotencyKey } = loadStore(async () => {
    throw new Error("Redis must not be used by this pure test");
  });

  assert.equal(normalizeIdempotencyKey(null), null);
  assert.equal(normalizeIdempotencyKey(undefined), null);
  assert.equal(normalizeIdempotencyKey(""), null);
  assert.equal(normalizeIdempotencyKey("   "), null);
  assert.equal(normalizeIdempotencyKey("  retry-123  "), "retry-123");
  assert.equal(normalizeIdempotencyKey("x".repeat(256)), "x".repeat(256));
  assert.throws(
    () => normalizeIdempotencyKey("x".repeat(257)),
    /at most 256 characters/,
  );
});

test("creates stable, operation-scoped Redis keys", () => {
  const { createIdempotencyRedisKey } = loadStore(async () => {
    throw new Error("Redis must not be used by this pure test");
  });

  const body = { title: "Retry-safe task", project_id: 15 };
  const first = createIdempotencyRedisKey(
    "create_task",
    6,
    "client-key",
    body,
  );
  const second = createIdempotencyRedisKey(
    "create_task",
    6,
    "client-key",
    body,
  );

  assert.equal(first, second);
  assert.notEqual(
    first,
    createIdempotencyRedisKey("create_comment", 6, "client-key", body),
  );
  assert.notEqual(
    first,
    createIdempotencyRedisKey("create_task", 6, "client-key", {
      ...body,
      title: "Different task",
    }),
  );
});

test("caches a successful response for 24 hours and flags replays", async () => {
  const values = new Map();
  const setCalls = [];
  const redis = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value, ...options) => {
      if (options.includes("NX") && values.has(key)) return null;
      values.set(key, value);
      setCalls.push({ key, value, options });
      return "OK";
    },
    del: async (key) => {
      values.delete(key);
      return 1;
    },
  };
  const { withIdempotency } = loadStore(async () => redis);
  let producerCalls = 0;
  const producer = async () => {
    producerCalls += 1;
    return { task: { id: 42 } };
  };

  const first = await withIdempotency(
    "create_task",
    6,
    "client-key",
    { title: "Task" },
    producer,
  );
  const replay = await withIdempotency(
    "create_task",
    6,
    "client-key",
    { title: "Task" },
    producer,
  );

  assert.deepEqual(first, { task: { id: 42 } });
  assert.deepEqual(replay, {
    task: { id: 42 },
    idempotent_replayed: true,
  });
  assert.equal(producerCalls, 1);
  // Two-phase: an NX pending claim (EX 60) then the published result (EX 86400).
  const publish = setCalls.find((c) => c.options.includes(86_400));
  assert.ok(publish, "expected a 24h publish SET");
  assert.equal(publish.value, JSON.stringify({ task: { id: 42 } }));
  const claim = setCalls.find((c) => c.options.includes("NX"));
  assert.ok(claim, "expected an NX pending-claim SET");
});

// NX-aware in-memory Redis: SET with 'NX' only writes if the key is absent.
// This models the atomic claim the concurrency guarantee depends on.
function makeNxRedis() {
  const values = new Map();
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value, ...options) => {
      const nx = options.includes("NX");
      if (nx && values.has(key)) return null; // claim already held
      values.set(key, value);
      return "OK";
    },
    del: async (key) => {
      values.delete(key);
      return 1;
    },
  };
}

test("concurrent same-key requests run the producer exactly once", async () => {
  const redis = makeNxRedis();
  const { withIdempotency } = loadStore(async () => redis);

  let producerCalls = 0;
  let releaseProducer;
  const gate = new Promise((resolve) => {
    releaseProducer = resolve;
  });
  // First producer is held open so the second request lands while the first
  // still holds the pending claim — the exact GET/GET → miss/miss race.
  const slowProducer = async () => {
    producerCalls += 1;
    await gate;
    return { task: { id: 99 } };
  };
  const fastProducer = async () => {
    producerCalls += 1;
    return { task: { id: 99 } };
  };

  const first = withIdempotency("create_task", 6, "k", { t: "x" }, slowProducer);
  // Let the first claim the key before the second starts.
  await new Promise((r) => setTimeout(r, 20));
  const secondP = withIdempotency("create_task", 6, "k", { t: "x" }, fastProducer);
  // Release the first so it publishes its result while the second is waiting.
  setTimeout(() => releaseProducer(), 50);

  const [firstRes, secondRes] = await Promise.all([first, secondP]);

  assert.equal(producerCalls, 1, "producer must run exactly once");
  assert.deepEqual(firstRes, { task: { id: 99 } });
  assert.deepEqual(secondRes, { task: { id: 99 }, idempotent_replayed: true });
});

test("runs without caching when Redis is unavailable", async () => {
  const { withIdempotency } = loadStore(async () => {
    throw new Error("Redis unavailable");
  });
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const result = await withIdempotency(
      "create_comment",
      6,
      "client-key",
      { text: "Hello" },
      async () => ({ success: true, comment: { id: 7 } }),
    );

    assert.deepEqual(result, { success: true, comment: { id: 7 } });
  } finally {
    console.warn = originalWarn;
  }
});
