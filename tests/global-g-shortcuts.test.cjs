const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");

const root = path.join(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const { createGlobalGShortcutCapture, resolveGlobalGShortcut } = jiti(
  path.join(root, "src/lib/keyboard/globalGShortcuts.ts"),
);

test("every documented global g sequence resolves without modifiers", () => {
  const expected = {
    65: "All Tasks",
    66: "Board",
    67: "Calendar",
    68: "Drafts",
    69: "Task Archive",
    72: "Reminders",
    73: "Inbox",
    77: "My Tasks",
    80: "Pinned",
    82: "Inbox Archive",
    83: "Starred",
    84: "Timers",
    85: "Scheduled",
    186: "Snippets",
  };
  for (const [keyCode, action] of Object.entries(expected)) {
    assert.equal(
      resolveGlobalGShortcut({
        keyCode: Number(keyCode),
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      }),
      action,
    );
  }
  assert.equal(
    resolveGlobalGShortcut({
      keyCode: 51,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
    }),
    "Trash",
  );
});

test("the capture handler wins over a Calendar surface shortcut", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  let timestamp = 1_000;
  const actions = [];
  let calendarNextRuns = 0;
  const handler = createGlobalGShortcutCapture({
    delayMs: 1_000,
    now: () => timestamp,
    onShortcut: (action) => actions.push(action),
  });
  dom.window.document.addEventListener("keydown", handler, true);
  dom.window.document.addEventListener("keydown", (event) => {
    if (event.keyCode === 73) calendarNextRuns += 1;
  });

  dom.window.document.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: "g",
      code: "KeyG",
      keyCode: 71,
      bubbles: true,
      cancelable: true,
    }),
  );
  timestamp += 100;
  const secondKey = new dom.window.KeyboardEvent("keydown", {
    key: "i",
    code: "KeyI",
    keyCode: 73,
    bubbles: true,
    cancelable: true,
  });
  dom.window.document.dispatchEvent(secondKey);

  assert.deepEqual(actions, ["Inbox"]);
  assert.equal(secondKey.defaultPrevented, true);
  assert.equal(calendarNextRuns, 0);
  dom.window.close();
});

test("expired or typing-context sequences leave surface shortcuts alone", () => {
  let timestamp = 1_000;
  let ignored = false;
  const actions = [];
  const handler = createGlobalGShortcutCapture({
    delayMs: 500,
    now: () => timestamp,
    shouldIgnore: () => ignored,
    onShortcut: (action) => actions.push(action),
  });
  const event = (keyCode) => ({
    keyCode,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    preventDefault() {},
    stopImmediatePropagation() {},
  });

  handler(event(71));
  timestamp += 600;
  handler(event(73));
  ignored = true;
  handler(event(71));
  ignored = false;
  handler(event(73));

  assert.deepEqual(actions, []);
});
