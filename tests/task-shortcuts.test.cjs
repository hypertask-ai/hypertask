const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/task-shortcuts-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  getTaskShortcutAction,
  shouldIgnoreTaskShortcutTarget,
} = jiti(path.join(root, "src/lib/keyboard/taskShortcuts.ts"));

const event = (keyCode, modifiers = {}) => ({
  altKey: false,
  ctrlKey: false,
  keyCode,
  metaKey: false,
  repeat: false,
  shiftKey: false,
  ...modifiers,
});

const WINDOWS_SHORTCUTS = [
  [event(88), "select"],
  [event(51, { shiftKey: true }), "delete"],
  [event(69, { ctrlKey: true }), "archive"],
  [event(83), "size"],
  [event(80), "priority"],
  [event(69), "edit"],
  [event(65), "assignee"],
  [event(68), "dueDate"],
  [event(84), "label"],
  [event(83, { ctrlKey: true }), "share"],
  [event(77), "moveColumn"],
  [event(77, { shiftKey: true }), "moveBoard"],
  [event(13), "open"],
  [event(83, { altKey: true }), "star"],
  [event(113), "rename"],
];

test("maps the Kanban task shortcut set on Windows and Linux", () => {
  for (const [keyboardEvent, action] of WINDOWS_SHORTCUTS) {
    assert.equal(getTaskShortcutAction(keyboardEvent, false), action);
  }
});

test("uses Command instead of Control for platform-modified task actions on Apple", () => {
  assert.equal(
    getTaskShortcutAction(event(69, { metaKey: true }), true),
    "archive",
  );
  assert.equal(
    getTaskShortcutAction(event(83, { metaKey: true }), true),
    "share",
  );
  assert.equal(
    getTaskShortcutAction(event(65, { ctrlKey: true }), true),
    null,
    "Ctrl+A must not open assignee on Apple",
  );
});

test("does not turn positional or follower shortcuts into table task actions", () => {
  assert.equal(
    getTaskShortcutAction(event(75, { shiftKey: true }), false),
    null,
  );
  assert.equal(getTaskShortcutAction(event(70), false), null);
  assert.equal(
    getTaskShortcutAction(event(70, { altKey: true }), false),
    null,
  );
  assert.equal(
    getTaskShortcutAction(event(88, { repeat: true }), false),
    null,
  );
  assert.equal(
    getTaskShortcutAction(event(51, { shiftKey: true, repeat: true }), false),
    null,
    "held Shift+3 must not keep deleting",
  );
  assert.equal(
    getTaskShortcutAction(event(68, { shiftKey: true }), false),
    null,
  );
});

test("ignores editable and modal shortcut targets", () => {
  assert.equal(shouldIgnoreTaskShortcutTarget({ tagName: "INPUT" }), true);
  assert.equal(shouldIgnoreTaskShortcutTarget({ tagName: "textarea" }), true);
  assert.equal(shouldIgnoreTaskShortcutTarget({ tagName: "select" }), true);
  assert.equal(
    shouldIgnoreTaskShortcutTarget({ tagName: "DIV", isContentEditable: true }),
    true,
  );
  assert.equal(
    shouldIgnoreTaskShortcutTarget({
      tagName: "SPAN",
      closest: () => ({ role: "dialog" }),
    }),
    true,
  );
  assert.equal(
    shouldIgnoreTaskShortcutTarget({
      tagName: "BUTTON",
      closest: () => null,
    }),
    false,
  );
  assert.equal(shouldIgnoreTaskShortcutTarget(null), false);
});
