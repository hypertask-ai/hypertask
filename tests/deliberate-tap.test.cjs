const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(
  path.join(__dirname, "../src/lib/utils/deliberateTap.ts"),
  "utf8",
);

const javascript = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const module_ = { exports: {} };
new Function("module", "exports", javascript)(module_, module_.exports);
const { createTapGuard } = module_.exports;

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
  // The summary teaser sits above the scroll body: dragging off it must not open
  // the sheet, which is the whole point of the guard.
  const guard = createTapGuard();
  guard.start(100, 200);
  guard.move(104, 260);
  assert.equal(guard.isStray(), true);
});

test("a click with no touch of its own is stray once the device has shown touch", () => {
  // Send collapses the composer and the mic lands in its slot, so the click from
  // the tap on Send arrives at a mic that never saw a touchstart.
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
