const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const { QueryClient, dehydrate } = require("@tanstack/react-query");
const { persistQueryClientSubscribe } = require("@tanstack/react-query-persist-client");

const jiti = createJiti(__filename, {
  interopDefault: true,
  moduleCache: false,
});
const {
  MAX_PERSISTED_QUERY_BYTES,
  limitPersistedClientWithinBudget,
  serializePersistedClientWithinBudget,
  shouldDehydratePersistedQuery,
} = jiti(path.join(__dirname, "../src/utils/queryPersistence.ts"));

const observeMeasurements = (t) => {
  const stringify = JSON.stringify;
  const encode = TextEncoder.prototype.encode;
  const measured = [];
  const encoded = [];
  t.mock.method(JSON, "stringify", function (value, ...args) {
    measured.push(value);
    return stringify.call(this, value, ...args);
  });
  t.mock.method(TextEncoder.prototype, "encode", function (value) {
    encoded.push(value);
    return encode.call(this, value);
  });
  return { measured, encoded };
};

const subscribe = (client, isEnabled, persisted) =>
  persistQueryClientSubscribe({
    queryClient: client,
    persister: {
      persistClient: (value) => { persisted.push(value); },
      restoreClient: () => undefined,
      removeClient: () => undefined,
    },
    dehydrateOptions: {
      shouldDehydrateQuery: (query) =>
        shouldDehydratePersistedQuery(query, isEnabled()),
    },
  });

const addQuery = (client, queryKey, data) => {
  client.setQueryData(queryKey, data);
  return client.getQueryCache().find({ queryKey, exact: true });
};

test("the persistence size flag is an Everyone improvement", () => {
  const definition = jiti(path.join(__dirname, "../src/lib/flags/definitions/htpr-7555-persist-size-once.ts"));
  assert.equal(definition.key, "htpr-7555-persist-size-once");
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-22");
  assert.equal(definition.releaseRisk.risk, "small");
});

test("a second real cache event reuses unchanged data size with the flag on", (t) => {
  const client = new QueryClient();
  const data = { setting: "😀" };
  const query = addQuery(client, ["setting"], data);
  const persisted = [];
  const measurements = observeMeasurements(t);
  const unsubscribe = subscribe(client, () => true, persisted);
  try {
    query.setState({ isInvalidated: true });
    query.setState({ isInvalidated: false });
    assert.equal(persisted.length, 2);
    assert.equal(measurements.measured.filter((value) => value === data).length, 1);
    assert.equal(measurements.encoded.length, 1);
    assert.equal(persisted[0].clientState.queries[0].state.data, data);
    assert.equal(persisted[1].clientState.queries[0].state.data, data);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("changed data is remeasured and an oversized result is also reused", (t) => {
  const client = new QueryClient();
  const small = { setting: true };
  const large = { setting: "x".repeat(MAX_PERSISTED_QUERY_BYTES) };
  const query = addQuery(client, ["setting"], small);
  const persisted = [];
  const measurements = observeMeasurements(t);
  const unsubscribe = subscribe(client, () => true, persisted);
  try {
    query.setState({ isInvalidated: true });
    query.setState({ data: large });
    query.setState({ isInvalidated: false });
    assert.deepEqual(persisted.map((value) => value.clientState.queries.length), [1, 0, 0]);
    assert.equal(measurements.measured.filter((value) => value === small).length, 1);
    assert.equal(measurements.measured.filter((value) => value === large).length, 1);
    assert.equal(measurements.encoded.length, 2);
    query.setState({ data: { setting: false } });
    assert.equal(persisted[3].clientState.queries.length, 1);
    assert.equal(measurements.encoded.length, 3);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("switching the flag off restores measurement on every cache event", (t) => {
  const client = new QueryClient();
  const data = { setting: true };
  const query = addQuery(client, ["setting"], data);
  let enabled = true;
  const persisted = [];
  const measurements = observeMeasurements(t);
  const unsubscribe = subscribe(client, () => enabled, persisted);
  try {
    query.setState({ isInvalidated: true });
    enabled = false;
    query.setState({ isInvalidated: false });
    query.setState({ isInvalidated: true });
    assert.equal(measurements.measured.filter((value) => value === data).length, 3);
    assert.equal(measurements.encoded.length, 3);
    enabled = true;
    query.setState({ isInvalidated: false });
    assert.equal(measurements.encoded.length, 3);
    assert.equal(persisted.length, 4);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("primitive data is reused without treating different values as unchanged", (t) => {
  const client = new QueryClient();
  const query = addQuery(client, ["setting"], "hello");
  const measurements = observeMeasurements(t);
  try {
    assert.equal(shouldDehydratePersistedQuery(query, true), true);
    assert.equal(shouldDehydratePersistedQuery(query, true), true);
    query.setState({ data: "x".repeat(MAX_PERSISTED_QUERY_BYTES) });
    assert.equal(shouldDehydratePersistedQuery(query, true), false);
    assert.equal(shouldDehydratePersistedQuery(query, true), false);
    assert.equal(measurements.encoded.length, 2);
  } finally {
    client.clear();
  }
});

test("status, excluded families and hydrating guards are checked before cache reuse", (t) => {
  const client = new QueryClient();
  const query = addQuery(client, ["setting"], { setting: true });
  const measurements = observeMeasurements(t);
  try {
    assert.equal(shouldDehydratePersistedQuery(query, true), true);
    query.setState({ status: "error" });
    assert.equal(shouldDehydratePersistedQuery(query, true), false);
    query.setState({ status: "pending" });
    assert.equal(shouldDehydratePersistedQuery(query, true), false);
    query.setState({ status: "success" });
    for (const family of ["projectsAll", "boardTasks", "cached-task-detail", "projectLabels", "chat-sessions", "comments", "inbox", "agent-inbox", "archivedInbox", "user-preferences"]) {
      query.queryKey = [family];
      assert.equal(shouldDehydratePersistedQuery(query, true), false);
    }
    query.queryKey = ["setting", "hydrating"];
    assert.equal(shouldDehydratePersistedQuery(query, true), false);
    query.queryKey = ["setting"];
    assert.equal(shouldDehydratePersistedQuery(query, true), true);
    assert.equal(measurements.encoded.length, 1);
  } finally {
    client.clear();
  }
});

test("mixed eligibility, bounded client and persisted bytes are identical on and off", (t) => {
  t.mock.method(Date, "now", () => 1_792_627_200_000);
  const client = new QueryClient();
  const cycle = {};
  cycle.self = cycle;
  const cases = [
    ["small", { value: "😀" }, true],
    ["array", [1, null, "value"], true],
    ["null", null, true],
    ["at-limit", "x".repeat(MAX_PERSISTED_QUERY_BYTES - 2), true],
    ["over-limit", "x".repeat(MAX_PERSISTED_QUERY_BYTES - 1), false],
    ["oversized", { value: "x".repeat(MAX_PERSISTED_QUERY_BYTES) }, false],
    ["multibyte", "😀".repeat(40 * 1024), false],
    ["cyclic", cycle, false],
    ["bigint", { value: 1n }, false],
    ["throws", { toJSON() { throw new Error("not serializable"); } }, false],
    ["omitted", { value: undefined, ignored: () => true }, true],
    ["comments", { value: "excluded" }, false],
  ];
  try {
    const queries = cases.map(([key, data]) => addQuery(client, [key], data));
    const expected = cases.map(([, , eligible]) => eligible);
    assert.deepEqual(queries.map((query) => shouldDehydratePersistedQuery(query, false)), expected);
    assert.deepEqual(queries.map((query) => shouldDehydratePersistedQuery(query, true)), expected);
    assert.deepEqual(queries.map((query) => shouldDehydratePersistedQuery(query, true)), expected);
    const snapshot = (enabled) => ({
      timestamp: Date.now(),
      buster: "startup-budget-v3-view-show-archived",
      clientState: dehydrate(client, {
        shouldDehydrateQuery: (query) => shouldDehydratePersistedQuery(query, enabled),
      }),
    });
    const off = snapshot(false);
    const on = snapshot(true);
    assert.deepEqual(on, off);
    assert.deepEqual(limitPersistedClientWithinBudget(on), limitPersistedClientWithinBudget(off));
    assert.equal(serializePersistedClientWithinBudget(on), serializePersistedClientWithinBudget(off));
  } finally {
    client.clear();
  }
});

test("failed serialization is retried rather than remembering a transient exception", () => {
  const client = new QueryClient();
  let calls = 0;
  const data = { toJSON() { if (++calls === 1) throw new Error("retry"); return { setting: true }; } };
  const query = addQuery(client, ["setting"], data);
  try {
    assert.equal(shouldDehydratePersistedQuery(query, true), false);
    assert.equal(shouldDehydratePersistedQuery(query, true), true);
    assert.equal(calls, 2);
  } finally {
    client.clear();
  }
});
