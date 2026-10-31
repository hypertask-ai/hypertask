const test = require("node:test");
const assert = require("node:assert");

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
  assert.deepStrictEqual(extend([40, 41], 1), [1, 40, 41]);
});

test("the range stays ascending even when the window starts below the pin", () => {
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
