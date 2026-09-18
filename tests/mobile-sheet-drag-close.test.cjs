const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const packageEntry = require.resolve("react-modal-sheet");
const packageRoot = path.resolve(path.dirname(packageEntry), "..");
const jiti = createJiti(__filename, { interopDefault: true });
const { classifyDragEnd } = jiti(path.join(packageRoot, "src/snap.ts"));

test("closing a mobile sheet during drag release uses its measured height", () => {
  const result = classifyDragEnd({
    y: 160,
    info: {
      delta: { x: 0, y: 20 },
      offset: { x: 0, y: 160 },
      point: { x: 0, y: 160 },
      velocity: { x: 0, y: 0 },
    },
    sheetHeight: 200,
    snapPoints: [],
    dragVelocityThreshold: 500,
    dragCloseThreshold: 0.6,
  });

  assert.deepEqual(result, { yTo: 200, snapIndex: undefined });
});
