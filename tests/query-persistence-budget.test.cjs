const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const jiti = createJiti(__filename, {
  interopDefault: true,
  moduleCache: false,
});

const {
  MAX_PERSISTED_CLIENT_BYTES,
  limitPersistedClientWithinBudget,
  serializePersistedClientWithinBudget,
  shouldDehydratePersistedQuery,
} = jiti(path.join(__dirname, "../src/utils/queryPersistence.ts"));

const successfulQuery = (queryKey, data, dataUpdatedAt = 1) => ({
  queryKey,
  state: {
    data,
    dataUpdatedAt,
    error: null,
    errorUpdateCount: 0,
    errorUpdatedAt: 0,
    fetchFailureCount: 0,
    fetchFailureReason: null,
    fetchMeta: null,
    isInvalidated: false,
    status: "success",
    fetchStatus: "idle",
  },
});

test("large and startup-critical query families are never persisted", () => {
  assert.equal(
    shouldDehydratePersistedQuery(successfulQuery(["boardTasks", 1], { tasks: [] })),
    false
  );
  assert.equal(
    shouldDehydratePersistedQuery(successfulQuery(["chat-sessions", "user"], [])),
    false
  );
  assert.equal(
    shouldDehydratePersistedQuery(successfulQuery(["small-setting"], { enabled: true })),
    true
  );
  assert.equal(
    shouldDehydratePersistedQuery(successfulQuery(["large"], "x".repeat(129 * 1024))),
    false
  );
  assert.equal(
    shouldDehydratePersistedQuery(
      successfulQuery(["multibyte"], "😀".repeat(40 * 1024))
    ),
    false
  );
});

test("serialized cache stays within budget and keeps newest queries first", () => {
  const queries = Array.from({ length: 30 }, (_, index) => ({
    dehydratedAt: index,
    state: { dataUpdatedAt: index, data: "x".repeat(100 * 1024) },
    queryKey: ["query", index],
    queryHash: `query-${index}`,
  }));
  const serialized = serializePersistedClientWithinBudget({
    timestamp: Date.now(),
    buster: "test",
    clientState: { mutations: [], queries },
  });
  const persisted = JSON.parse(serialized);

  assert.ok(Buffer.byteLength(serialized, "utf8") <= MAX_PERSISTED_CLIENT_BYTES);
  assert.equal(persisted.clientState.queries[0].queryKey[1], 29);
  assert.ok(persisted.clientState.queries.length < queries.length);
});

test("serialized cache budgets mutations and multibyte payloads", () => {
  const serialized = serializePersistedClientWithinBudget({
    timestamp: Date.now(),
    buster: "test",
    clientState: {
      mutations: [
        {
          mutationKey: ["oversized"],
          state: { data: "😀".repeat(600 * 1024) },
        },
      ],
      queries: [
        {
          state: { dataUpdatedAt: 1, data: { setting: true } },
          queryKey: ["small-setting"],
          queryHash: "small-setting",
        },
      ],
    },
  });
  const persisted = JSON.parse(serialized);

  assert.ok(Buffer.byteLength(serialized, "utf8") <= MAX_PERSISTED_CLIENT_BYTES);
  assert.equal(persisted.clientState.mutations.length, 0);
  assert.equal(persisted.clientState.queries.length, 1);
});

test("structured persistence uses the same bounded client as serialization", () => {
  const client = {
    timestamp: Date.now(),
    buster: "test",
    clientState: {
      mutations: [],
      queries: Array.from({ length: 30 }, (_, index) => ({
        state: { dataUpdatedAt: index, data: "x".repeat(100 * 1024) },
        queryKey: ["query", index],
        queryHash: `query-${index}`,
      })),
    },
  };
  const limited = limitPersistedClientWithinBudget(client);

  assert.equal(
    JSON.stringify(limited),
    serializePersistedClientWithinBudget(client),
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(limited), "utf8") <=
      MAX_PERSISTED_CLIENT_BYTES,
  );
});
