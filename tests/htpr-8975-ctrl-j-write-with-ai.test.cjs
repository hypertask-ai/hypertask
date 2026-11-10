const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const { loadModule: load } = require("./helpers/loadModule.cjs");
const { loader } = require("./helpers/htpr-7260-ui.cjs");

const flagKey = "htpr-8975-ctrl-j-write-with-ai";
const flagModule = "@/lib/flags/definitions/htpr-8975-ctrl-j-write-with-ai";
const flagStub = { HTPR_8975_CTRL_J_WRITE_WITH_AI_FLAG: flagKey };

test("HTPR-8975 flag ships at Owner + QA as an improvement", () => {
  const { default: flag, HTPR_8975_CTRL_J_WRITE_WITH_AI_FLAG: key } = load("src/lib/flags/definitions/htpr-8975-ctrl-j-write-with-ai.ts");
  assert.equal(key, flagKey);
  assert.equal(flag.key, key);
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.risk, "small");
});

function globalShortcut(enabled) {
  const dom = new JSDOM(
    '<div data-ctrl-j-write-with-ai=""><div contenteditable="true" id="comment-editor"></div><input id="panel-input"></div><div id="board"></div>',
  );
  const calls = [];
  const cleanups = [];
  const { useCommandCenterShortcut } = load("src/hooks/General/useCommandCenterShortcut.ts", {
    react: { useEffect: (effect) => cleanups.push(effect()) },
    "@/lib/constants/commandCenterShortcut": load("src/lib/constants/commandCenterShortcut.ts"),
    "@/hooks/useFlag": { useFlag: (key) => key === flagKey && enabled },
    "@/lib/flags/keys": { HTPR_7547_SEARCH_LAZY_CLOSED_FLAG: "a", HTPR_7571_INBOX_CTRLK_CLOSE_FLAG: "b" },
    [flagModule]: flagStub,
    "@/lib/state": { useSetRecoilState: () => (value) => calls.push(["palette", value]) },
    "@/store": { showCommandsAtom: "commands" },
    "@/models/enums": { CommandMode: { Command: "command" } },
  });
  const previous = global.document;
  global.document = dom.window.document;
  try {
    useCommandCenterShortcut(1, false, "/detail/project-15/8975", false, false, () => calls.push(["toggle"]));
  } finally {
    global.document = previous;
  }
  const press = (id) => {
    const reached = [];
    const target = dom.window.document.getElementById(id);
    target.addEventListener("keydown", () => reached.push(id));
    const event = new dom.window.KeyboardEvent("keydown", { key: "j", code: "KeyJ", ctrlKey: true, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return { reached: reached.length > 0, prevented: event.defaultPrevented };
  };
  return { calls, press };
}

test("Ctrl+J inside a ticket editor or its Write with AI box reaches the editor with the flag on", () => {
  for (const id of ["comment-editor", "panel-input"]) {
    const { calls, press } = globalShortcut(true);
    const result = press(id);
    assert.equal(result.reached, true, `${id} receives Ctrl+J`);
    assert.equal(result.prevented, true, `${id} blocks the browser's own Ctrl+J`);
    assert.deepEqual(calls, [], `${id} does not open New task`);
  }
});

test("Ctrl+J outside a ticket editor still opens New task with the flag on", () => {
  const { calls, press } = globalShortcut(true);
  const result = press("board");
  assert.equal(result.reached, false);
  assert.deepEqual(calls, [["palette", { show: true, mode: "command", paletteTab: "compose" }]]);
});

test("flag off keeps today's Ctrl+J New task inside ticket editors", () => {
  const { calls, press } = globalShortcut(false);
  const result = press("comment-editor");
  assert.equal(result.reached, false);
  assert.deepEqual(calls, [["palette", { show: true, mode: "command", paletteTab: "compose" }]]);
});

function editorKeyboard(enabled, mode) {
  const actions = [];
  const { useTaskDetailEditorKeyboard } = loader({
    "@/hooks/useFlag": { useFlag: (key) => key === flagKey ? enabled : false },
    [flagModule]: flagStub,
    "@/lib/state": { useSetRecoilState: () => (value) => actions.push(["commands", value]) },
    "@/store": { showCommandsAtom: "commands" },
    "@/models/enums": { CommandMode: { Command: "command" } },
    "@/lib/taskDetailInboxFlow": { resolveCommentEnterShortcutAction: () => null },
  })("src/components/RTE/useTaskDetailEditorKeyboard.tsx");
  const context = { mode, isApple: false, shouldShowInlineDraftAiRef: {}, toggleAiTaskWriter: () => actions.push(["write-with-ai"]) };
  let prevented = false;
  useTaskDetailEditorKeyboard(() => context).handleKeydown({ key: "J", code: "KeyJ", keyCode: 74, ctrlKey: true, preventDefault: () => { prevented = true; } });
  return { actions, prevented };
}

test("Ctrl+J in comment, comment edit and description editors opens Write with AI with the flag on", () => {
  for (const mode of ["create-comment", "read-edit-comments", "read-edit-description"]) {
    const { actions, prevented } = editorKeyboard(true, mode);
    assert.equal(prevented, true);
    assert.deepEqual(actions, [["write-with-ai"]], mode);
  }
});

const cn = (...values) => values.flat().filter(Boolean).join(" ");

function panel(enabled) {
  const micProps = [];
  const { default: InlineDraftAiFloat } = loader({
    "@/components/Common/SendArrow": { SendArrow: () => React.createElement("svg", { "data-arrow": true }) },
    "@/components/RTE/Components/AudioButton": {
      AudioButton: (props) => {
        micProps.push(props);
        return React.createElement("button", { "data-mic": true });
      },
    },
    "@/components/Modals/Sheets/AppSheet": { AppSheet: ({ children }) => React.createElement("div", null, children) },
    "@/hooks/General/useMobileVisualViewport": { useMobileVisualViewport: () => null },
    "@/utils/undoActions/helperFuncs": { cn },
    "@/utils/helperFunctions/sanitizeHtml": { sanitizeAiHtml: (html) => html },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "../Common/Tooltip": { default: () => null },
    "react-hot-toast": { default: { dismiss: () => {}, promise: async (promise) => promise } },
  })("src/components/RTE/Components/InlineDraftAiFloat.tsx");
  const editor = {
    state: { selection: { from: 1, to: 1 }, doc: { content: { size: 2 } } },
    isEmpty: true,
    isEditable: true,
    commands: { setTextSelection: () => {}, unsetHighlight: () => {}, focus: () => {} },
    on: () => {},
    off: () => {},
    setEditable: () => {},
  };
  const html = renderToStaticMarkup(
    React.createElement(InlineDraftAiFloat, {
      editor,
      onClose: () => {},
      toggleRecording: () => {},
      matchCommentRowControls: enabled,
    }),
  );
  return { doc: new JSDOM(html).window.document, micProps };
}

test("Write with AI box shows one white mic and a Rewrite word with the flag on", () => {
  const { doc, micProps } = panel(true);
  assert.equal(doc.querySelectorAll("[data-mic]").length, 1);
  assert.equal(micProps[0].primaryMic, true);
  assert.equal(micProps[0].compactListeningPill, true);
  assert.equal(micProps[0].hideDevicePicker, true);
  assert.deepEqual(micProps[0].hoverTooltip, { text: "Dictate", keyCombination: ["ALT", "V"] });
  const buttons = [...doc.querySelectorAll("button")].filter((button) => button.textContent.trim() === "Rewrite");
  assert.equal(buttons.length, 1);
  assert.equal(doc.querySelector("[data-arrow]"), null);
  assert.doesNotMatch(buttons[0].className, /purple|rounded-full/);
});

test("flag off keeps today's purple arrow and plain mic in the Write with AI box", () => {
  const { doc, micProps } = panel(false);
  assert.equal(micProps[0].primaryMic, undefined);
  assert.equal(micProps[0].hoverTooltip, undefined);
  assert.ok(doc.querySelector('[aria-label="Send AI instruction"] [data-arrow]'));
  assert.equal([...doc.querySelectorAll("button")].some((button) => button.textContent.trim() === "Rewrite"), false);
});
