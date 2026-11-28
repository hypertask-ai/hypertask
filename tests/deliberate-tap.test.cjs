const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

const { createTapGuard } = loadModule("src/lib/utils/deliberateTap.ts");

test("a mouse click passes: no touch ever happened", () => {
  const guard = createTapGuard();
  assert.equal(guard.isStray(), false);
});

test("a tap that stays put opens the control", () => {
  const guard = createTapGuard();
  guard.start(100, 200);
  guard.move(102, 203);
  assert.equal(guard.isStray(), false);
});

test("a flick that starts on the control is not a tap", () => {
  const guard = createTapGuard();
  guard.start(100, 200);
  guard.move(104, 260);
  assert.equal(guard.isStray(), true);
});

test("a click with no touch of its own is stray once the device has shown touch", () => {
  const guard = createTapGuard();
  guard.start(100, 200);
  guard.isStray();
  assert.equal(guard.isStray(), true);
});

test("a stray click does not poison the next real tap", () => {
  const guard = createTapGuard();
  guard.start(100, 200);
  guard.isStray();
  assert.equal(guard.isStray(), true);
  guard.start(100, 200);
  assert.equal(guard.isStray(), false);
});
