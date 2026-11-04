const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");

const flagFile = "src/lib/flags/definitions/htpr-8639-calendar-picker-shortcut.ts";

test("calendar picker shortcut flag is a reversible bugfix for everyone", () => {
  const { default: flag } = loadModule(flagFile);
  assert.equal(flag.key, "htpr-8639-calendar-picker-shortcut");
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
});

for (const enabled of [true, false]) {
  test(`calendar due date shortcut and later typing with flag ${enabled ? "on" : "off"}`, () => {
    const dom = new JSDOM("<button>Task</button>");
    const errors = [];
    dom.window.addEventListener("error", (event) => {
      errors.push(event.error || event.message);
      event.preventDefault();
    });
    const previousDocument = global.document;
    const previousWindow = global.window;
    global.document = dom.window.document;
    global.window = dom.window;
    let cleanup;
    let input;
    let opened = 0;
    try {
      const { useCalendarKeyboard } = loadModule("src/hooks/Calendar/useCalendarKeyboard.ts", {
        react: {
          useCallback: (callback) => callback,
          useEffect: (effect) => { cleanup = effect(); },
        },
        "@/hooks/useFlag": { useFlag: () => enabled },
        "@/lib/flags/keys": { HTPR_8639_CALENDAR_PICKER_SHORTCUT_FLAG: "htpr-8639-calendar-picker-shortcut" },
        "@/utils/helperFunctions/helperFunctions": {
          returnIfModalOrInputActive: () => document.activeElement?.tagName === "INPUT",
        },
      });
      useCalendarKeyboard({
        currentTask: 42,
        createTaskModal: { show: false },
        showDueDateModal: { show: false },
        showFilterModal: false,
        isApple: false,
        lastGClickRef: { current: null },
        toggleDueDateModal: (mode) => {
          assert.equal(mode, "Update");
          opened++;
          input = document.createElement("input");
          document.body.append(input);
          input.focus();
        },
      });
      const task = document.querySelector("button");
      task.focus();
      const dispatchTyping = (target, key, keyCode) => {
        const event = new dom.window.KeyboardEvent("keydown", { key, keyCode, bubbles: true, cancelable: true });
        const allowed = target.dispatchEvent(event);
        if (allowed && document.activeElement?.tagName === "INPUT") document.activeElement.value += key;
        return event;
      };
      const shortcut = dispatchTyping(task, "d", 68);
      assert.deepEqual(errors, []);
      assert.equal(opened, 1);
      assert.equal(shortcut.defaultPrevented, enabled);
      assert.equal(input.value, enabled ? "" : "d");
      const typed = dispatchTyping(input, "m", 77);
      assert.deepEqual(errors, []);
      assert.equal(typed.defaultPrevented, false);
      assert.equal(input.value, enabled ? "m" : "dm");
      assert.equal(opened, 1);
    } finally {
      cleanup?.();
      dom.window.close();
      global.document = previousDocument;
      global.window = previousWindow;
    }
  });
}
