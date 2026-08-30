const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createRoot } = require("react-dom/client");

const rootDir = path.resolve(__dirname, "..");
require("tsx/cjs");
const { UndoProvider, useUndoContext } = require(
  path.join(rootDir, "src/hooks/General/useUndo.tsx"),
);

test("Ctrl+Z can undo in the same tick that an inbox archive registers", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://app.hypertask.ai/inbox",
  });
  const previousGlobals = {
    window: global.window,
    document: global.document,
    HTMLElement: global.HTMLElement,
    Element: global.Element,
    KeyboardEvent: global.KeyboardEvent,
    IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT,
  };
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(
    global,
    "navigator",
  );
  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    KeyboardEvent: dom.window.KeyboardEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(global, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });

  let undo;
  const Harness = () => {
    undo = useUndoContext();
    return null;
  };
  const reactRoot = createRoot(document.getElementById("root"));

  try {
    await React.act(async () => {
      reactRoot.render(
        React.createElement(UndoProvider, null, React.createElement(Harness)),
      );
    });

    const pressUndo = () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    let undoCalls = 0;
    const registerUndo = (id) =>
      undo.performActionAndStoreUndoData(
        { notification: { id } },
        "Undo remove notification",
        async () => {
          undoCalls += 1;
        },
      );

    await React.act(async () => {
      registerUndo("1");
      pressUndo();
      await Promise.resolve();
    });
    assert.equal(undoCalls, 1);

    await React.act(async () => {
      pressUndo();
      await Promise.resolve();
    });
    assert.equal(undoCalls, 1, "an undo entry can only run once");

    const input = document.createElement("input");
    document.body.append(input);
    await React.act(async () => {
      registerUndo("2");
      input.focus();
      pressUndo();
      await Promise.resolve();
    });
    assert.equal(undoCalls, 1, "text fields keep their native undo behavior");

    input.blur();
    await React.act(async () => {
      pressUndo();
      await Promise.resolve();
    });
    assert.equal(undoCalls, 2, "the pending app undo remains available");
  } finally {
    await React.act(async () => reactRoot.unmount());
    dom.window.close();
    Object.assign(global, previousGlobals);
    if (previousNavigatorDescriptor) {
      Object.defineProperty(global, "navigator", previousNavigatorDescriptor);
    } else {
      delete global.navigator;
    }
  }
});
