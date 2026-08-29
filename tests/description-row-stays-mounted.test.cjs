// HTPR-4950. The task description lives in the detail view's virtualized list.
// Scrolling it out of the window unmounted the whole subtree, and an embedded
// Figma, Loom or YouTube iframe cannot survive an unmount: it cold-reloaded
// every time you scrolled back up.
//
// The range extractor now always includes the description row. This pins the
// two properties the virtualizer depends on: the row is present, and the range
// stays ascending and unique.
const test = require("node:test");
const assert = require("node:assert");

// Mirrors the extractor in src/hooks/Task Detail/useTaskDetailGlobalStates.ts.
const extend = (normalRange, pinned) => {
  if (pinned < 0 || normalRange.includes(pinned)) return normalRange;
  return Array.from(new Set([pinned, ...normalRange])).sort((a, b) => a - b);
};

const isAscendingAndUnique = (range) =>
  range.every((value, i) => i === 0 || value > range[i - 1]);

test("the description row survives being scrolled far away", () => {
  const window = [40, 41, 42, 43];
  assert.deepStrictEqual(extend(window, 0), [0, 40, 41, 42, 43]);
});

test("mobile pins index 1, where the description actually sits", () => {
  // Index 0 is TaskInfo on mobile. The old code hardcoded 0 and so never
  // pinned the description there at all.
  assert.deepStrictEqual(extend([40, 41], 1), [1, 40, 41]);
});

test("the range stays ascending even when the window starts below the pin", () => {
  // Mobile, scrolled to the very top: the window holds 0 but not 1.
  const result = extend([0], 1);
  assert.ok(isAscendingAndUnique(result), `not ascending: ${result}`);
  assert.deepStrictEqual(result, [0, 1]);
});

test("a window already containing the row is returned untouched", () => {
  const window = [0, 1, 2];
  assert.strictEqual(extend(window, 0), window);
});

test("no description row means no pin", () => {
  assert.deepStrictEqual(extend([5, 6], -1), [5, 6]);
});
