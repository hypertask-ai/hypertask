import assert from "node:assert/strict";
import test from "node:test";

import { isControlQFocusShortcut } from "../src/lib/aiChat/chatFocusShortcut";

const shortcutEvent = (overrides: Partial<KeyboardEvent> = {}) =>
  ({
    key: "q",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...overrides,
  }) as KeyboardEvent;

test("a keyless keydown is ignored without throwing", () => {
  const event = new Event("keydown");

  assert.doesNotThrow(() => isControlQFocusShortcut(event));
  assert.equal(isControlQFocusShortcut(event), false);
});

test("only exact Control+Q keydowns match the focus shortcut", () => {
  assert.equal(isControlQFocusShortcut(shortcutEvent()), true);
  assert.equal(
    isControlQFocusShortcut(shortcutEvent({ key: "Q" })),
    true,
  );
  assert.equal(
    isControlQFocusShortcut(shortcutEvent({ key: "x" })),
    false,
  );
  assert.equal(
    isControlQFocusShortcut(shortcutEvent({ shiftKey: true })),
    false,
  );
  assert.equal(
    isControlQFocusShortcut(shortcutEvent({ repeat: true })),
    false,
  );
});
