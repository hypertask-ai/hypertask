// HTPR-5528: clicking the visible UNDO on the archive toast left the task
// archived. The undo entry expires 15s after the action, but react-hot-toast
// pauses the toast's 5s auto-dismiss while the pointer rests on it, so the
// button routinely stays on screen past that window and every click was
// dropped silently.
//
// Run: npm run test:file -- tests/undo-window-trigger.test.ts
import assert from "node:assert/strict";
import {
  canRunUndo,
  isUndoWindowExpired,
} from "../src/hooks/General/undoWindow";

const WINDOW_MS = 15_000;
const archivedAt = 1_000_000;
const pending = { expiresAt: archivedAt + WINDOW_MS };

// The reported failure: the agent hovers the toast (pausing its dismissal),
// reads it, and clicks UNDO 40s after archiving. That click must restore.
assert.equal(
  canRunUndo(pending, "toast", archivedAt + 40_000),
  true,
  "a click on the still-visible UNDO button must run, however long it took",
);

// The happy path stays unchanged.
assert.equal(
  canRunUndo(pending, "toast", archivedAt + 2_000),
  true,
  "an immediate click still runs",
);
assert.equal(
  canRunUndo(pending, "shortcut", archivedAt + 2_000),
  true,
  "Ctrl+Z inside the window still runs",
);

// Ctrl+Z has no on-screen affordance, so it keeps the bounded window: a
// keypress long after the action must not silently resurrect an old task.
assert.equal(
  canRunUndo(pending, "shortcut", archivedAt + WINDOW_MS + 1),
  false,
  "Ctrl+Z after the action window is ignored",
);
assert.equal(
  canRunUndo(pending, "shortcut", archivedAt + WINDOW_MS),
  false,
  "the window boundary is exclusive for the shortcut",
);

// Nothing pending means nothing to undo, whatever triggered it.
assert.equal(canRunUndo(null, "toast", archivedAt), false);
assert.equal(canRunUndo(undefined, "shortcut", archivedAt), false);

// The expiry predicate itself still drives entry cleanup and retry extension.
assert.equal(isUndoWindowExpired(pending, archivedAt + 1), false);
assert.equal(isUndoWindowExpired(pending, archivedAt + WINDOW_MS), true);
assert.equal(isUndoWindowExpired(null, archivedAt), true);

console.log("undo-window-trigger: all checks passed");
