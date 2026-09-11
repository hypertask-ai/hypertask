import assert from "node:assert/strict";
import test from "node:test";
import { getFixedOverlayPosition } from "../src/lib/emojiPickerPosition";

test("opens below the trigger when there is room", () => {
  const position = getFixedOverlayPosition(
    { top: 100, bottom: 120, left: 40 },
    {
      height: 370,
      width: 300,
      viewportHeight: 900,
      viewportWidth: 1200,
    },
  );

  assert.equal(position.top, 124);
  assert.equal(position.left, 40);
});

test("opens above when below cannot fit height plus gap and padding", () => {
  const position = getFixedOverlayPosition(
    { top: 700, bottom: 720, left: 40 },
    {
      height: 370,
      width: 300,
      // 800 - 720 = 80 below; needed = 370 + 4 + 8 = 382
      viewportHeight: 800,
      viewportWidth: 1200,
    },
  );

  assert.equal(position.top, 700 - 370 - 4);
  assert.equal(position.left, 40);
});

test("stays below when below has room for height plus gap and padding", () => {
  const position = getFixedOverlayPosition(
    { top: 100, bottom: 120, left: 40 },
    {
      height: 370,
      width: 300,
      viewportHeight: 900,
      viewportWidth: 1200,
    },
  );

  assert.equal(position.top, 124);
});

test("keeps the picker inside the viewport horizontally", () => {
  const position = getFixedOverlayPosition(
    { top: 100, bottom: 120, left: 1100 },
    {
      height: 200,
      width: 300,
      viewportHeight: 900,
      viewportWidth: 1200,
    },
  );

  assert.equal(position.left, 1200 - 300 - 8);
});

console.log("emoji picker position tests passed");
