const test = require("node:test");
const assert = require("node:assert/strict");
const { loader } = require("./helpers/htpr-7260-ui.cjs");
const {
  decidePhoneCardGesture: decide,
  MOBILE_TASK_DRAG_DELAY_MS: hold,
  MOBILE_TASK_DRAG_TOLERANCE_PX: tolerance,
} = loader()("src/hooks/Kanban/mobileBoardGestures.ts");

for (const hasSelection of [false, true]) {
  test(`hold-release selects at the hold boundary, selection=${hasSelection}`, () => {
    assert.equal(decide(hold, 0, hasSelection), "select");
    assert.equal(decide(hold + 1000, tolerance, hasSelection), "select");
  });

  test(`moving past tolerance takes precedence over selection, selection=${hasSelection}`, () => {
    for (const duration of [0, hold - 1, hold, hold + 1000]) {
      assert.equal(decide(duration, tolerance + 0.01, hasSelection), "drag");
    }
  });
}

test("a plain tap opens only when selection is empty", () => {
  for (const duration of [0, hold - 1]) {
    for (const movement of [0, tolerance]) {
      assert.equal(decide(duration, movement, false), "open");
      assert.equal(decide(duration, movement, true), "toggle");
    }
  }
});
