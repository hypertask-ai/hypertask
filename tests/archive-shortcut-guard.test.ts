import assert from "node:assert/strict";
import test from "node:test";

import {
  handleArchiveShortcutKeyUp,
  resetArchiveShortcutGuard,
  shouldRunArchiveShortcut,
} from "../src/lib/keyboard/archiveShortcutGuard";

test("a single press archives once", () => {
  resetArchiveShortcutGuard();
  assert.equal(shouldRunArchiveShortcut({ repeat: false }), true);
});

test("a long press archives exactly one task, however long it is held", () => {
  resetArchiveShortcutGuard();
  let archived = 0;
  for (let repeat = 0; repeat < 100; repeat += 1) {
    if (shouldRunArchiveShortcut({ repeat: repeat > 0 })) archived += 1;
  }
  assert.equal(archived, 1);
});

test("auto-repeat reported as discrete presses is still held to one task", () => {
  resetArchiveShortcutGuard();
  let archived = 0;
  // X11 auto-repeat and some remote desktops deliver repeat === false.
  for (let repeat = 0; repeat < 100; repeat += 1) {
    if (shouldRunArchiveShortcut({ repeat: false })) archived += 1;
  }
  assert.equal(
    archived,
    1,
    "a held key must never run away across cards or columns",
  );
});

test("rapid separate taps each archive without a cooldown", () => {
  resetArchiveShortcutGuard();
  for (let tap = 0; tap < 20; tap += 1) {
    assert.equal(shouldRunArchiveShortcut({ repeat: false }), true);
    handleArchiveShortcutKeyUp({ code: "KeyE" });
  }
});

test("the held state is shared across the next card and column", () => {
  resetArchiveShortcutGuard();
  assert.equal(shouldRunArchiveShortcut({ repeat: false }), true);
  // A different card component handling the same held key gets the same answer.
  assert.equal(shouldRunArchiveShortcut({ repeat: false }), false);
  assert.equal(shouldRunArchiveShortcut({ repeat: false }), false);
});

test("only releasing E opens the guard for the next press", () => {
  resetArchiveShortcutGuard();
  assert.equal(shouldRunArchiveShortcut({ repeat: false }), true);

  handleArchiveShortcutKeyUp({ key: "Control" });
  assert.equal(shouldRunArchiveShortcut({ repeat: false }), false);

  handleArchiveShortcutKeyUp({ key: "e" });
  assert.equal(shouldRunArchiveShortcut({ repeat: false }), true);
});
