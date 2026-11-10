const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const { loadModule: load } = require("./helpers/loadModule.cjs");
const { loader } = require("./helpers/htpr-7260-ui.cjs");

const root = path.resolve(__dirname, "..");
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
  const Provider = () => ({ mode, editor: null, newCommentAttachments: [], isEditModeActive, id: "editor" });
  const { default: TiptapMainContainer } = load("src/components/RTE/Components/TiptapMainContainer.tsx", {
    "@/lib/contexts/TaskDetail/TiptapProvider": { useTiptapGlobalContext: Provider },
    "@/hooks/useFlag": { useFlag: (key) => key === flagKey && enabled },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/styles/tiptap.module.scss": { default: {} },
    "./CreatedInfoTiptap": { default: empty },
    "./TiptapEditor": { default: empty },
    "@/components/Common/AttachmentsUpload": { default: empty },
    "@/components/Common/FileDragAndDrop": { default: ({ children }) => children },
    "./InlineDraftAiFloat": { default: empty },
    "lucide-react": { X: empty },
  });
  return new JSDOM(renderToStaticMarkup(React.createElement(TiptapMainContainer))).window.document;
}

test("editable ticket editors carry the Ctrl+J marker only with the flag on", () => {
  for (const mode of ["create-comment", "read-edit-comments", "read-edit-description"]) {
    assert.ok(editorContainer({ enabled: true, mode }).querySelector("[data-ctrl-j-write-with-ai]"), mode);
    assert.equal(editorContainer({ enabled: false, mode }).querySelector("[data-ctrl-j-write-with-ai]"), null, mode);
  }
  assert.equal(
    editorContainer({ enabled: true, mode: "read-edit-description", isEditModeActive: false }).querySelector("[data-ctrl-j-write-with-ai]"),
    null,
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

const micProps = [];
const originalCache = new Map(Object.entries(require.cache));
const stubSourceModule = (relativePath, exports) => {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
stubSourceModule("src/components/Common/SendArrow.tsx", {
  SendArrow: () => React.createElement("svg", { "data-arrow": "" }),
});
stubSourceModule("src/components/RTE/Components/AudioButton.tsx", {
  AudioButton: (props) => {
    micProps.push(props);
    return React.createElement("button", { type: "button", "data-mic": "" });
  },
});
stubSourceModule("src/components/Modals/Sheets/AppSheet.tsx", {
  AppSheet: ({ children }) => React.createElement("div", null, children),
});
stubSourceModule("src/hooks/General/useMobileVisualViewport.ts", { useMobileVisualViewport: () => null });
stubSourceModule("src/styles/tiptap.module.scss", { editorContainer: "editor-container" });
stubSourceModule("src/utils/undoActions/helperFuncs.ts", { cn: (...values) => values.filter(Boolean).join(" ") });
const previousGlobalReact = global.React;
global.React = React;
const jiti = require("jiti")(__filename, { interopDefault: true, jsx: true, alias: { "@": path.join(root, "src") } });
const InlineDraftAiFloat = jiti(path.join(root, "src/components/RTE/Components/InlineDraftAiFloat.tsx")).default;
for (const filename of Object.keys(require.cache)) {
  if (!originalCache.has(filename)) delete require.cache[filename];
}
for (const [filename, cachedModule] of originalCache) require.cache[filename] = cachedModule;
test.after(() => {
  if (previousGlobalReact === undefined) delete global.React;
  else global.React = previousGlobalReact;
});

async function panel(t, enabled) {
  micProps.length = 0;
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
  const keys = ["window", "document", "HTMLElement", "Node", "Event", "MouseEvent", "CustomEvent", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = Object.fromEntries(keys.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const editor = {
    state: { selection: { from: 1, to: 1 }, doc: { content: { size: 2 } } },
    isEmpty: true,
    isEditable: true,
    view: { dom: dom.window.document.createElement("div") },
    commands: { setTextSelection: () => {}, unsetHighlight: () => {}, focus: () => {} },
    on: () => {},
    off: () => {},
    setEditable: () => {},
  };
  const container = dom.window.document.getElementById("root");
  const reactRoot = createRoot(container);
  t.after(async () => {
    await act(async () => reactRoot.unmount());
    for (const key of keys) {
      if (previous[key]) Object.defineProperty(global, key, previous[key]);
      else delete global[key];
    }
    dom.window.close();
  });
  await act(async () => {
    reactRoot.render(React.createElement(InlineDraftAiFloat, {
      editor,
      onClose: () => {},
      toggleRecording: () => {},
      matchCommentRowControls: enabled,
    }));
  });
  return container;
}

test("Write with AI box shows one white mic, a Rewrite word and the comment box colour with the flag on", async (t) => {
  const container = await panel(t, true);
  assert.equal(container.querySelectorAll("[data-mic]").length, 1);
  const mic = micProps.at(-1);
  assert.equal(mic.primaryMic, true);
  assert.equal(mic.compactListeningPill, true);
  assert.equal(mic.hideDevicePicker, true);
  assert.equal(mic.hoverTooltip.text, "Dictate");
  assert.equal(mic.hoverTooltip.keyCombination.at(-1), "V");
  const rewrite = [...container.querySelectorAll("button")].filter((button) => button.textContent.trim() === "Rewrite");
  assert.equal(rewrite.length, 1);
  assert.equal(container.querySelector("[data-arrow]"), null);
  assert.doesNotMatch(rewrite[0].className, /purple|rounded-full/);
  const box = container.querySelector('[aria-label="Write with AI"]');
  assert.match(box.className, /bg-newcomment-well/);
  assert.doesNotMatch(box.className, /purple|shadow-md/);
});

test("flag off keeps today's purple arrow, plain mic and purple border in the Write with AI box", async (t) => {
  const container = await panel(t, false);
  const mic = micProps.at(-1);
  assert.equal(mic.primaryMic, undefined);
  assert.equal(mic.hoverTooltip, undefined);
  assert.ok(container.querySelector('[aria-label="Send AI instruction"] [data-arrow]'));
  assert.equal([...container.querySelectorAll("button")].some((button) => button.textContent.trim() === "Rewrite"), false);
  assert.match(container.querySelector('[aria-label="Write with AI"]').className, /border-hypertasks-ai-purple\/70 bg-comment-description/);
});
