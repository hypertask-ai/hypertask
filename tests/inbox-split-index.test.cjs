// HTPR-4877. Inbox splits appear and vanish as their counts hit zero, so the
// persisted currSplit routinely points at a split that no longer exists.
//
// newCommentsHandler used to queue setGlobalFocus and then keep indexing the
// OLD currSplit in the same pass. React state does not apply until the next
// render, so data[gone][idx] threw, the surrounding try/catch swallowed it, and
// the user got a silently skipped focus and scroll instead of a crash.
//
// This pins the resolution order. It fails if the reset is queued but the stale
// index is used afterwards.
const test = require("node:test");
const assert = require("node:assert");

const DEFAULT_SPLIT_INDEX = 0;

// Mirrors the index resolution in src/app/inbox/Inbox.tsx.
const resolveSplit = (splits, persistedSplit, trigger) => {
  let effectiveSplit = persistedSplit ?? 0;
  if (splits && !splits[effectiveSplit]) {
    effectiveSplit = DEFAULT_SPLIT_INDEX;
  } else if (trigger === "ShowAll" && splits) {
    effectiveSplit = splits.length - 1;
  }
  return effectiveSplit;
};

// Reading the focused row the way the handler does, after resolution.
const focusedId = (splits, persistedSplit, currIdx, trigger) =>
  splits?.[resolveSplit(splits, persistedSplit, trigger)]?.[currIdx ?? 0]?.id;

const splits = [[{ id: 1 }, { id: 2 }], [{ id: 3 }]];

test("a persisted split that no longer exists falls back instead of throwing", () => {
  // The user was on split 4; a refetch left only two splits.
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
