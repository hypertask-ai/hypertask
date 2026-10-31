const test = require("node:test");
const assert = require("node:assert");

const DEFAULT_SPLIT_INDEX = 0;

const resolveSplit = (splits, persistedSplit, trigger) => {
  let effectiveSplit = persistedSplit ?? 0;
  if (splits && !splits[effectiveSplit]) {
    effectiveSplit = DEFAULT_SPLIT_INDEX;
  } else if (trigger === "ShowAll" && splits) {
    effectiveSplit = splits.length - 1;
  }
  return effectiveSplit;
};

const focusedId = (splits, persistedSplit, currIdx, trigger) =>
  splits?.[resolveSplit(splits, persistedSplit, trigger)]?.[currIdx ?? 0]?.id;

const splits = [[{ id: 1 }, { id: 2 }], [{ id: 3 }]];

test("a persisted split that no longer exists falls back instead of throwing", () => {
  assert.doesNotThrow(() => focusedId(splits, 4, 0));
  assert.strictEqual(resolveSplit(splits, 4), DEFAULT_SPLIT_INDEX);
  assert.strictEqual(focusedId(splits, 4, 0), 1);
});

test("a split that still exists is kept", () => {
  assert.strictEqual(resolveSplit(splits, 1), 1);
  assert.strictEqual(focusedId(splits, 1, 0), 3);
});

test("ShowAll jumps to the last split", () => {
  assert.strictEqual(resolveSplit(splits, 0, "ShowAll"), 1);
});

test("an out-of-range row index yields undefined rather than throwing", () => {
  assert.doesNotThrow(() => focusedId(splits, 1, 99));
  assert.strictEqual(focusedId(splits, 1, 99), undefined);
});

test("no splits at all is survivable", () => {
  assert.doesNotThrow(() => focusedId(undefined, 3, 0));
  assert.strictEqual(focusedId(undefined, 3, 0), undefined);
});
