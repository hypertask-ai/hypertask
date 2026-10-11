// HTPR-7124: on phones a double tap on description text must open the editor, while a single tap and controls never do.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(__dirname, "../src") },
});
const { useDoubleTap } = jiti(path.join(__dirname, "../src/hooks/MultiPages/useDoubleTap.ts"));
const { isTaskDetailEditTarget } = jiti(path.join(__dirname, "../src/lib/taskDetailEditTarget.ts"));

// The description card (useDoubleTap with the HTPR-7044 guard) around a read-only editor body.
// stopInEditor mirrors the editor's click handler: true is the old behaviour, false the HTPR-7124 one.
async function renderDescription(stopInEditor) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: global.window, document: global.document, Element: global.Element, act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let opened = 0;
  function Card() {
    const bind = useDoubleTap(() => { opened += 1; }, 200, {
      shouldHandleEvent: (event) => isTaskDetailEditTarget(event.target, event.currentTarget),
    });
    return React.createElement("div", { ...bind, "data-target": "card" },
      React.createElement("div", { contentEditable: false, suppressContentEditableWarning: true, onClick: (e) => stopInEditor && e.stopPropagation() },
        React.createElement("p", { "data-target": "text" }, "Description text"),
        React.createElement("button", { "data-target": "emoji" }, "emoji")));
  }
  const root = createRoot(document.getElementById("root"));
  await React.act(async () => root.render(React.createElement(Card)));
  const tap = async (selector, count) => {
    const el = document.querySelector(`[data-target='${selector}']`);
    await React.act(async () => {
      for (let i = 1; i <= count; i += 1) el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, detail: i }));
      if (count === 2) el.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true, detail: 2 }));
    });
  };
  return {
    tap,
    opened: () => opened,
    cleanup: async () => {
      await React.act(async () => root.unmount());
      dom.window.close();
      Object.assign(global, { window: previous.window, document: previous.document, Element: previous.Element });
      global.IS_REACT_ACT_ENVIRONMENT = previous.act;
    },
  };
}

test("old behaviour: the read-only editor swallows the taps, so a double tap on text never opens the editor", async () => {
  const card = await renderDescription(true);
  try {
    await card.tap("text", 2);
    assert.equal(card.opened(), 0);
  } finally { await card.cleanup(); }
});

test("fixed: a double tap on description text opens the editor", async () => {
  const card = await renderDescription(false);
  try {
    await card.tap("text", 2);
    assert.equal(card.opened(), 1);
  } finally { await card.cleanup(); }
});

test("fixed: a single tap on text does not open the editor (HTPR-7044)", async () => {
  const card = await renderDescription(false);
  try {
    await card.tap("text", 1);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(card.opened(), 0);
  } finally { await card.cleanup(); }
});

test("fixed: a double tap on the emoji button does not open the editor (HTPR-7044)", async () => {
  const card = await renderDescription(false);
  try {
    await card.tap("emoji", 2);
    assert.equal(card.opened(), 0);
  } finally { await card.cleanup(); }
});

test("the editor passes taps up only for a read-only description, behind the bugfix flag", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/components/RTE/Components/TiptapEditor.tsx"), "utf8");
  assert.match(source, /const passTapsUp = phoneDoubleTapDescription && mode === "read-edit-description" && !isEditable;/);
  assert.match(source, /onClick=\{\(e\) => !passTapsUp && !editor\?\.isFocused && e\.stopPropagation\(\)\}/);
  const flag = fs.readFileSync(path.join(__dirname, "../src/lib/flags/definitions/htpr-7124-phone-double-tap-description.ts"), "utf8");
  assert.match(flag, /kind: "bugfix"/);
});
