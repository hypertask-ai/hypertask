const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const filename = path.join(__dirname, "..", "src/lib/assigneeRecency.ts");
const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const loaded = new Module(filename);
loaded.filename = filename;
loaded._compile(javascript, filename);

const {
  readRecentAssigneeKeys,
  recordRecentAssigneeUse,
  sortAssigneeOptionsByRecency,
} = loaded.exports;

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};

const immediateLocks = {
  request: (_name, callback) => Promise.resolve(callback()),
};

test("most recently selected people appear first", () => {
  const people = [
    { id: 1, displayName: "Alpha" },
    { id: 2, displayName: "Bravo" },
    { id: 3, displayName: "Charlie" },
  ];

  assert.deepEqual(
    sortAssigneeOptionsByRecency(people, ["user:3", "user:1"]).map(
      ({ id }) => id,
    ),
    [3, 1, 2],
  );
});

test("currently assigned options stay ahead of recent unassigned options", () => {
  const people = [
    { id: 1, assigned: false },
    { id: 2, assigned: true },
    { id: 3, assigned: false },
  ];

  assert.deepEqual(
    sortAssigneeOptionsByRecency(people, ["user:3", "user:1"]).map(
      ({ id }) => id,
    ),
    [2, 3, 1],
  );
});

test("people and agents with the same raw ID have separate recency keys", () => {
  const options = [
    { id: "7", displayName: "Agent Seven" },
    { id: "8", displayName: "Agent Eight" },
  ];

  assert.deepEqual(
    sortAssigneeOptionsByRecency(options, ["user:7", "agent:8"]).map(
      ({ id }) => id,
    ),
    ["8", "7"],
  );
});

test("recording selections creates a deduplicated most-recent-first list", () => {
  const storage = createStorage();

  recordRecentAssigneeUse(storage, 6, { id: 10 }, immediateLocks);
  recordRecentAssigneeUse(storage, 6, { id: "agent-a" }, immediateLocks);
  recordRecentAssigneeUse(storage, 6, { id: 10 }, immediateLocks);

  assert.deepEqual(readRecentAssigneeKeys(storage, 6), [
    "user:10",
    "agent:agent-a",
  ]);
});

test("recency is scoped per signed-in user and ignores clear options", () => {
  const storage = createStorage();

  recordRecentAssigneeUse(storage, 6, { id: 10 }, immediateLocks);
  recordRecentAssigneeUse(storage, 6, { id: 0 }, immediateLocks);

  assert.deepEqual(readRecentAssigneeKeys(storage, 6), ["user:10"]);
  assert.deepEqual(readRecentAssigneeKeys(storage, 7), []);
});

test("recency history stays bounded", () => {
  const storage = createStorage();
  for (let id = 1; id <= 60; id += 1) {
    recordRecentAssigneeUse(storage, 6, { id }, immediateLocks);
  }

  const recent = readRecentAssigneeKeys(storage, 6);
  assert.equal(recent.length, 50);
  assert.equal(recent[0], "user:60");
  assert.equal(recent.at(-1), "user:11");
});

test("origin-wide locking preserves concurrent tab selections", async () => {
  const storage = createStorage();
  let tail = Promise.resolve();
  const locks = {
    request: (_name, callback) => {
      const result = tail.then(callback);
      tail = result.catch(() => undefined);
      return result;
    },
  };

  await Promise.all([
    recordRecentAssigneeUse(storage, 6, { id: 10 }, locks),
    recordRecentAssigneeUse(storage, 6, { id: 11 }, locks),
  ]);

  assert.deepEqual(readRecentAssigneeKeys(storage, 6), [
    "user:11",
    "user:10",
  ]);
});

test("unavailable or rejected locks never perform an unsafe fallback write", async () => {
  const storage = createStorage();

  recordRecentAssigneeUse(storage, 6, { id: 10 });
  await recordRecentAssigneeUse(storage, 6, { id: 11 }, {
    request: () => Promise.reject(new Error("locks unavailable")),
  });

  assert.deepEqual(readRecentAssigneeKeys(storage, 6), []);
});

test("malformed or unavailable storage falls back without blocking assignment", () => {
  const brokenStorage = {
    getItem: () => "not-json",
    setItem: () => {
      throw new Error("storage unavailable");
    },
  };

  assert.deepEqual(readRecentAssigneeKeys(brokenStorage, 6), []);
  assert.doesNotThrow(() =>
    recordRecentAssigneeUse(brokenStorage, 6, { id: 10 }, immediateLocks),
  );
});
