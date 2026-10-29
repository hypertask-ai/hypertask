const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(__dirname, "../src") },
});
const { useDoubleTap } = jiti(path.join(__dirname, "../src/hooks/MultiPages/useDoubleTap.ts"));
const { isTaskDetailEditTarget } = jiti(path.join(__dirname, "../src/lib/taskDetailEditTarget.ts"));

async function renderDescription({ mode = "read-edit-description", isEditable = false, isFocused = false, mobile = true } = {}) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = { window: global.window, document: global.document, Element: global.Element, act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const MobileViewContext = React.createContext(mobile);
  let opened = 0;
  let expanded = 0;
  const TiptapEditor = loadModule("src/components/RTE/Components/TiptapEditor.tsx", {
    "@/lib/contexts/TaskDetail/TiptapProvider": { useTiptapGlobalContext: () => ({
      mode, isEditable, editor: { isFocused, isEmpty: false }, id: "description",
      toggleExpansion: () => { expanded += 1; }, toggleHighlightHandler: () => {},
    }) },
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/styles/tiptap.module.scss": { default: {} },
    "./DragHandleTiptap": { default: () => null },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/keys": {},
    "@tiptap/react": { EditorContent: ({ onClick }) => React.createElement("div", { onClick },
      React.createElement("p", { "data-target": "text" }, "Description text"),
      React.createElement("button", { "data-target": "emoji" }, "emoji")) },
  }).default;
  function Card() {
    const bind = useDoubleTap(() => { opened += 1; }, 200, {
      shouldHandleEvent: (event) => isTaskDetailEditTarget(event.target, event.currentTarget),
    });
    return React.createElement("div", bind, React.createElement(TiptapEditor));
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
    expanded: () => expanded,
    cleanup: async () => {
      await React.act(async () => root.unmount());
      dom.window.close();
      Object.assign(global, { window: previous.window, document: previous.document, Element: previous.Element });
      global.IS_REACT_ACT_ENVIRONMENT = previous.act;
    },
  };
}

test("a double tap on phone description text opens the editor without a flag", async () => {
  const card = await renderDescription();
  try {
    await card.tap("text", 2);
    assert.equal(card.opened(), 1);
  } finally { await card.cleanup(); }
});

test("a single tap on phone description text does not open the editor", async () => {
  const card = await renderDescription();
  try {
    await card.tap("text", 1);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(card.opened(), 0);
    assert.equal(card.expanded(), 1);
  } finally { await card.cleanup(); }
});

test("a double tap on the emoji button does not open the editor", async () => {
  const card = await renderDescription();
  try {
    await card.tap("emoji", 2);
    assert.equal(card.opened(), 0);
  } finally { await card.cleanup(); }
});

test("unfocused editable descriptions and comments keep swallowing phone taps", async () => {
  for (const options of [{ isEditable: true }, { mode: "create-comment" }, { mode: "read-edit-comments" }]) {
    const card = await renderDescription(options);
    try {
      await card.tap("text", 2);
      assert.equal(card.opened(), 0);
      assert.equal(card.expanded(), 0);
    } finally { await card.cleanup(); }
  }
});

test("focused comments and desktop editors preserve existing click bubbling", async () => {
  for (const options of [{ mode: "create-comment", isFocused: true }, { mobile: false, isEditable: true }]) {
    const card = await renderDescription(options);
    try {
      await card.tap("text", 1);
      assert.equal(card.expanded(), 1);
    } finally { await card.cleanup(); }
  }
});
