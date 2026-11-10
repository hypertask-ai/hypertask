const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { loadModule: load } = require("./helpers/loadModule.cjs");
const { loader } = require("./helpers/htpr-7260-ui.cjs");

const flagKey = "htpr-8975-ctrl-j-write-with-ai";
const empty = () => null;

test("HTPR-8975 flag ships at Owner + QA as an improvement", () => {
  const { default: flag, HTPR_8975_CTRL_J_WRITE_WITH_AI_FLAG: key } = load("src/lib/flags/definitions/htpr-8975-ctrl-j-write-with-ai.ts");
  assert.equal(key, flagKey);
  assert.equal(flag.key, key);
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.risk, "small");
});

function editorContainer({ enabled, mode, isEditModeActive = true }) {
  const panels = [];
  const Provider = () => ({
    mode,
    editor: { getText: () => "", getHTML: () => "" },
    newCommentAttachments: [],
    isEditModeActive,
    id: "editor",
    shouldShowInlineDraftAi: true,
    closeInlineDraftAi: () => {},
  });
  const { default: TiptapMainContainer } = load("src/components/RTE/Components/TiptapMainContainer.tsx", {
    "@/lib/contexts/TaskDetail/TiptapProvider": { useTiptapGlobalContext: Provider },
    "@/hooks/useFlag": { useFlag: (key) => key === flagKey && enabled },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/styles/tiptap.module.scss": { default: {} },
    "./CreatedInfoTiptap": { default: empty },
    "./TiptapEditor": { default: empty },
    "@/components/Common/AttachmentsUpload": { default: empty },
    "@/components/Common/FileDragAndDrop": { default: ({ children }) => children },
    "./InlineDraftAiFloat": { default: (props) => { panels.push(props); return null; } },
    "lucide-react": { X: empty },
  });
  const document = new JSDOM(renderToStaticMarkup(React.createElement(TiptapMainContainer))).window.document;
  return { marked: Boolean(document.querySelector("[data-ctrl-j-write-with-ai]")), panel: panels.at(-1) };
}

test("editable ticket editors carry the Ctrl+J marker and pass the app controls to Write with AI only with the flag on", () => {
  for (const mode of ["create-comment", "read-edit-comments", "read-edit-description"]) {
    const on = editorContainer({ enabled: true, mode });
    assert.equal(on.marked, true, mode);
    assert.equal(on.panel.matchCommentRowControls, true, mode);
    const off = editorContainer({ enabled: false, mode });
    assert.equal(off.marked, false, mode);
    assert.equal(off.panel.matchCommentRowControls, undefined, mode);
  }
  assert.equal(
    editorContainer({ enabled: true, mode: "read-edit-description", isEditModeActive: false }).marked,
    false,
    "a description that is not being edited keeps today's Ctrl+J",
  );
});

function globalShortcut() {
  const dom = new JSDOM(
    '<div data-ctrl-j-write-with-ai=""><div contenteditable="true" id="comment-editor"></div><input id="panel-input"></div><div id="board"></div>',
  );
  const calls = [];
  const { useCommandCenterShortcut } = load("src/hooks/General/useCommandCenterShortcut.ts", {
    react: { useEffect: (effect) => effect() },
    "@/lib/constants/commandCenterShortcut": load("src/lib/constants/commandCenterShortcut.ts"),
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/keys": { HTPR_7547_SEARCH_LAZY_CLOSED_FLAG: "a", HTPR_7571_INBOX_CTRLK_CLOSE_FLAG: "b" },
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
  const press = (id, code = "KeyJ") => {
    let reached = false;
    const target = dom.window.document.getElementById(id);
    target.addEventListener("keydown", () => { reached = true; });
    target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { code, ctrlKey: true, bubbles: true, cancelable: true }));
    return reached;
  };
  return { calls, press };
}

test("Ctrl+J inside a marked ticket editor or its Write with AI box reaches the editor", () => {
  for (const id of ["comment-editor", "panel-input"]) {
    const { calls, press } = globalShortcut();
    assert.equal(press(id), true, `${id} receives Ctrl+J`);
    assert.deepEqual(calls, [], `${id} does not open New task`);
  }
});

test("Ctrl+J outside a ticket editor still opens New task, and Ctrl+K is unchanged inside one", () => {
  const outside = globalShortcut();
  assert.equal(outside.press("board"), false);
  assert.deepEqual(outside.calls, [["palette", { show: true, mode: "command", paletteTab: "compose" }]]);
  const search = globalShortcut();
  assert.equal(search.press("comment-editor", "KeyK"), false);
  assert.deepEqual(search.calls, [["palette", { show: true, mode: "command", paletteTab: "search" }]]);
});

test("Ctrl+J that reaches comment, comment edit and description editors opens Write with AI", () => {
  for (const mode of ["create-comment", "read-edit-comments", "read-edit-description"]) {
    const actions = [];
    const { useTaskDetailEditorKeyboard } = loader({
      "@/hooks/useFlag": { useFlag: (key) => ["htpr-7393-comment-inline-ai", "htpr-8173-description-inline-drafts"].includes(key) },
      "@/lib/state": { useSetRecoilState: () => (value) => actions.push(["commands", value]) },
      "@/store": { showCommandsAtom: "commands" },
      "@/models/enums": { CommandMode: { Command: "command" } },
      "@/lib/taskDetailInboxFlow": { resolveCommentEnterShortcutAction: () => null },
    })("src/components/RTE/useTaskDetailEditorKeyboard.tsx");
    const context = { mode, isApple: false, shouldShowInlineDraftAiRef: {}, toggleAiTaskWriter: () => actions.push(["write-with-ai"]) };
    let prevented = false;
    useTaskDetailEditorKeyboard(() => context).handleKeydown({ key: "j", code: "KeyJ", keyCode: 74, ctrlKey: true, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true, mode);
    assert.deepEqual(actions, [["write-with-ai"]], mode);
  }
});

function panel(t, enabled, { onClose = () => {}, onParentKeyDown } = {}) {
  const micProps = [];
  const arrow = () => React.createElement("svg", { "data-arrow": "" });
  const { default: InlineDraftAiFloat } = load("src/components/RTE/Components/InlineDraftAiFloat.tsx", {
    "@/components/Common/SendArrow": { SendArrow: arrow },
    "../Common/SendArrow": { SendArrow: arrow },
    "../Common/Tooltip": { default: empty },
    "@/components/RTE/Components/AudioButton": {
      AudioButton: (props) => {
        micProps.push(props);
        return React.createElement("button", { type: "button", "data-mic": "" });
      },
    },
    "@/components/Modals/Sheets/AppSheet": { AppSheet: ({ children }) => React.createElement("div", null, children) },
    "@/hooks/General/useMobileVisualViewport": { useMobileVisualViewport: () => null },
    "@/styles/tiptap.module.scss": { default: { editorContainer: "editor-container" } },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/utils/helperFunctions/sanitizeHtml": { sanitizeAiHtml: (html) => html },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/hooks/useFlag": { useFlag: (key) => key === flagKey && enabled },
    "react-hot-toast": { default: { dismiss: () => {}, error: () => {}, promise: (request) => request } },
  });
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
  const globals = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]));
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(global, name, { value, configurable: true, writable: true });
  const editor = {
    state: { selection: { from: 1, to: 1 }, doc: { content: { size: 2 } } },
    isEmpty: true,
    isEditable: true,
    view: { dom: dom.window.document.createElement("div") },
    contents: [],
    commands: {
      setTextSelection: () => {},
      unsetHighlight: () => {},
      focus: () => {},
      selectAll: () => {
        editor.state.selection = { from: 0, to: editor.state.doc.content.size };
      },
      setContent: (html) => {
        editor.contents.push(html);
        editor.isEmpty = false;
      },
    },
    on: () => {},
    off: () => {},
    setEditable: () => {},
  };
  const container = dom.window.document.getElementById("root");
  const reactRoot = createRoot(container);
  React.act(() => reactRoot.render(React.createElement(
    "div",
    { onKeyDown: onParentKeyDown },
    React.createElement(InlineDraftAiFloat, {
      editor,
      onClose,
      toggleRecording: () => {},
      matchCommentRowControls: enabled,
    }),
  )));
  t.after(() => {
    React.act(() => reactRoot.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  });
  const press = (target, init) =>
    React.act(() => {
      target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    });
  const rewrite = async (instruction) => {
    const input = container.querySelector('[aria-label="Write with AI"] input');
    const propsKey = Object.keys(input).find((name) => name.startsWith("__reactProps$"));
    React.act(() => {
      input[propsKey].onChange({ target: { value: instruction } });
    });
    assert.equal(input.value, instruction);
    await React.act(async () => {
      input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return input;
  };
  const doneShown = () => [...container.querySelectorAll("button")].some((button) => button.textContent.trim() === "Done");
  const box = () => container.querySelector('[aria-label="Write with AI"]');
  return { container, mic: micProps.at(-1), editor, press, rewrite, doneShown, box };
}

function editorKeyboard(editor, events) {
  const { useTaskDetailEditorKeyboard } = loader({
    "@/hooks/useFlag": { useFlag: (key) => ["htpr-7393-comment-inline-ai", "htpr-8173-description-inline-drafts"].includes(key) },
    "@/lib/state": { useSetRecoilState: () => (value) => events.push(["commands", value]) },
    "@/store": { showCommandsAtom: "commands" },
    "@/models/enums": { CommandMode: { Command: "command" } },
  })("src/components/RTE/useTaskDetailEditorKeyboard.tsx");
  const context = {
    mode: "create-comment",
    isApple: false,
    isInboxFlow: false,
    inInbox: false,
    editor,
    shouldShowInlineDraftAiRef: { current: true },
    sendComment: () => events.push(["send", editor.contents.at(-1)]),
    handleCallback: () => events.push(["callback"]),
    toggleAiTaskWriter: () => events.push(["write-with-ai"]),
  };
  return (event) => useTaskDetailEditorKeyboard(() => context).handleKeydown(event);
}

function answerWith(t, response) {
  const previous = global.fetch;
  global.fetch = response;
  t.after(() => {
    global.fetch = previous;
  });
}

const formalReply = async () => ({ ok: true, json: async () => ({ corrected_html: "<p>Formal reply</p>" }) });

function wiredPanel(t, enabled) {
  const events = [];
  let parentKeyDown = () => {};
  const box = panel(t, enabled, {
    onClose: () => events.push(["close"]),
    onParentKeyDown: (event) => parentKeyDown(event),
  });
  parentKeyDown = editorKeyboard(box.editor, events);
  return { ...box, events };
}

test("Write with AI box shows one white mic, a Rewrite word and the comment box colour with the flag on", (t) => {
  const { container, mic } = panel(t, true);
  assert.equal(container.querySelectorAll("[data-mic]").length, 1);
  assert.equal(mic.primaryMic, true);
  assert.equal(mic.compactListeningPill, true);
  assert.equal(mic.hideDevicePicker, true);
  assert.deepEqual(mic.hoverTooltip, { text: "Dictate", keyCombination: ["ALT", "V"] });
  const rewrite = [...container.querySelectorAll("button")].filter((button) => button.textContent.trim() === "Rewrite");
  assert.equal(rewrite.length, 1);
  assert.equal(container.querySelector("[data-arrow]"), null);
  assert.doesNotMatch(rewrite[0].className, /purple|rounded-full/);
  const box = container.querySelector('[aria-label="Write with AI"]');
  assert.match(box.className, /bg-newcomment-well/);
  assert.doesNotMatch(box.className, /purple|shadow-md/);
});

test("flag off keeps today's purple arrow, plain mic and purple border in the Write with AI box", (t) => {
  const { container, mic } = panel(t, false);
  assert.equal(mic.primaryMic, undefined);
  assert.equal(mic.hoverTooltip, undefined);
  assert.ok(container.querySelector('[aria-label="Send AI instruction"] [data-arrow]'));
  assert.equal([...container.querySelectorAll("button")].some((button) => button.textContent.trim() === "Rewrite"), false);
  assert.match(container.querySelector('[aria-label="Write with AI"]').className, /border-hypertasks-ai-purple\/70 bg-comment-description/);
});

test("Ctrl+Enter in the Write with AI box after Rewrite keeps the result, closes the box and sends the rewritten comment", async (t) => {
  answerWith(t, formalReply);
  const box = wiredPanel(t, true);
  await box.rewrite("make it formal");
  assert.equal(box.doneShown(), true, "result state shows Done");
  assert.ok(box.box().contains(document.activeElement), "focus comes back to the box");
  box.press(document.activeElement, { key: "Enter", ctrlKey: true });
  assert.deepEqual(box.events, [["close"], ["send", "<p>Formal reply</p>"]]);
});

test("Ctrl+Enter while the rewrite is still loading sends nothing and keeps the box open", async (t) => {
  answerWith(t, () => new Promise(() => {}));
  const box = wiredPanel(t, true);
  const input = await box.rewrite("make it formal");
  for (const target of [document.activeElement, input, box.box(), document.body]) {
    box.press(target, { key: "Enter", ctrlKey: true });
  }
  assert.deepEqual(box.events, []);
});

test("Ctrl+J in the result state reaches the editor and closes Write with AI", async (t) => {
  answerWith(t, formalReply);
  const box = wiredPanel(t, true);
  await box.rewrite("make it formal");
  assert.equal(box.doneShown(), true);
  assert.ok(box.box().contains(document.activeElement), "Ctrl+J starts inside the box, not on the page");
  box.press(document.activeElement, { key: "j", code: "KeyJ", keyCode: 74, ctrlKey: true });
  assert.deepEqual(box.events, [["write-with-ai"]]);
});

test("flag off keeps today's Ctrl+Enter in the Write with AI box: no send, no close, no focus change", async (t) => {
  answerWith(t, formalReply);
  const box = wiredPanel(t, false);
  const input = await box.rewrite("make it formal");
  assert.equal(box.doneShown(), true);
  box.press(input, { key: "Enter", ctrlKey: true });
  assert.deepEqual(box.events, []);
  assert.equal(box.box().getAttribute("tabindex"), null);
});
