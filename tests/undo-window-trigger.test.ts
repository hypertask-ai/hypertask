import assert from "node:assert/strict";
import {
  canRunUndo,
  isUndoWindowExpired,
} from "../src/hooks/General/undoWindow";

const WINDOW_MS = 15_000;
const archivedAt = 1_000_000;
const pending = { expiresAt: archivedAt + WINDOW_MS };

assert.equal(
  canRunUndo(pending, "toast", archivedAt + 40_000),
  true,
  "a click on the still-visible UNDO button must run, however long it took",
);

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

assert.equal(canRunUndo(null, "toast", archivedAt), false);
assert.equal(canRunUndo(undefined, "shortcut", archivedAt), false);

assert.equal(isUndoWindowExpired(pending, archivedAt + 1), false);
assert.equal(isUndoWindowExpired(pending, archivedAt + WINDOW_MS), true);
assert.equal(isUndoWindowExpired(null, archivedAt), true);

console.log("undo-window-trigger: all checks passed");
