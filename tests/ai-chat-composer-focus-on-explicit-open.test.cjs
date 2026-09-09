// HTPR-6317: the AI chat composer's mount-time focus loop must run only for
// explicit opens. Auto-open ("Open AI chat by default") and reload restore
// mount the panel at page load; if it focuses then, board keyboard shortcuts
// (c, j, k, Tab, /) silently type into the chat composer.
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  jsx: true,
  alias: { "@": path.join(root, "src") },
});

const originalCache = new Map(Object.entries(require.cache));
const stubModule = (filename, exports) => {
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
};
const stubSourceModule = (relativePath, exports) =>
  stubModule(path.join(root, relativePath), exports);

// In-memory stand-in for the aiChatExplicitOpenAtAtom write path, so each case
// can prime the timestamp the container's mount effect reads.
const EXPLICIT_OPEN_AT = { key: "aiChatExplicitOpenAt" };
let explicitOpenAt = null;
let explicitOpenAtWrites = [];
const setExplicitOpenAt = (value) => {
  explicitOpenAt = typeof value === "function" ? value(explicitOpenAt) : value;
  explicitOpenAtWrites.push(explicitOpenAt);
};

const TestChatContext = React.createContext(undefined);
let pathname = "/";

stubModule(require.resolve("@tiptap/react"), {
  EditorContent: () =>
    React.createElement("div", {
      className: "ProseMirror",
      contentEditable: true,
      tabIndex: 0,
      "data-testid": "composer",
    }),
  useEditorState: ({ editor, selector }) => selector({ editor }),
});
stubModule(require.resolve("next/navigation"), {
  usePathname: () => pathname,
});
stubModule(require.resolve("react-hot-toast"), {
  default: { error: () => {} },
});
stubSourceModule("src/components/Common/Tooltip.tsx", { default: () => null });
stubSourceModule("src/components/Global/ModelSelectorDropdown.tsx", {
  default: () => null,
});
stubSourceModule("src/components/Common/QueuedMessagesStrip.tsx", {
  QueuedMessagesStrip: () => null,
});
stubSourceModule("src/components/AI_CHAT/AiChatComposerActionRow.tsx", {
  AiChatComposerActionRow: () => null,
});
stubSourceModule("src/components/Common/AttachmentsUpload/ImageGalleryView.tsx", {
  default: () => null,
});
stubSourceModule("src/lib/contexts/deviceContext.tsx", {
  useDeviceContext: () => false,
});
stubSourceModule("src/lib/configs/aiTaskWriter.config.ts", {
  aiTaskWriterConfig: {
    shortcutsAndTooltips: {
      ai_chat: {
        attachment_button: () => ({}),
        send_button: {},
        cancel_stream_button: {},
        add_context_button: {},
      },
    },
  },
});
stubSourceModule(
  "src/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context.tsx",
  {
    useAiChatContext: () => React.useContext(TestChatContext),
  },
);
stubSourceModule("src/lib/state.tsx", {
  useRecoilState: (atom) =>
    atom === EXPLICIT_OPEN_AT ? [explicitOpenAt, setExplicitOpenAt] : [null, () => {}],
  useRecoilValue: () => null,
});
stubSourceModule("src/store/index.ts", {
  aiChatExplicitOpenAtAtom: EXPLICIT_OPEN_AT,
  currentProjectAtom: {},
  currentUserAtom: {},
  dockedChatScopeAtom: {},
  inViewObjectAtom: {},
  recentChatBoardIdsAtom: {},
});
stubSourceModule("src/hooks/MultiPages/useGetAllTeamsMinimal.ts", {
  useGetAllTeamsMinimal: () => ({ data: [] }),
});
stubSourceModule("src/utils/aiChat/sortBoardsByRecent.ts", {
  sortBoardsByRecent: (teams) => teams,
});
stubSourceModule("src/styles/tiptap.module.scss", {
  aiChatInput: "ai-chat-input",
  editorContainer: "editor-container",
});

const { MobileViewContext } = jiti(
  path.join(root, "src/lib/contexts/mobileContext.tsx"),
);
stubSourceModule("src/components/RTE/Components/AudioButton.tsx", {
  default: () => null,
});
const { AI_Tiptap_Container } = jiti(
  path.join(root, "src/components/AI_CHAT/AI_Tiptap_Container.tsx"),
);

for (const filename of Object.keys(require.cache)) {
  if (!originalCache.has(filename)) delete require.cache[filename];
}
for (const [filename, cachedModule] of originalCache) {
  require.cache[filename] = cachedModule;
}

const chatContextValue = {
  tiptapKeydown: () => {},
  editor: { isEmpty: true },
  isTyping: false,
  isRecording: false,
  queuedMessages: [],
  removeQueuedMessage: () => {},
  isByokBlocked: false,
  dropDownButtonAICallback: () => {},
  currentAiOption: {},
  displayAiOptions: [],
  contextList: [],
  handleSendMessage: async () => {},
  handleRemoveContext: () => {},
  handleAddContext: () => {},
  showScrollUpIndicator: false,
  scrollMessagesToBottom: () => {},
  handleCancelStream: async () => {},
  audioTiptapCallback: () => {},
  toggleRecording: () => {},
  handleAttachmentClick: () => {},
  handleFileUpload: async () => {},
  fileInputRef: { current: null },
  fileItems: [],
  removeFile: () => {},
};

// Mounts the composer in a fresh JSDOM, lets the 60ms focus loop run, and
// reports where the cursor ended up.
const mountComposer = async (primedOpenAt, focusAnotherField = false) => {
  const dom = new JSDOM(
    "<!doctype html><html><body><input id='other-field'><div id='root'></div></body></html>",
    { url: "https://app.hypertask.ai/" },
  );
  // React's async act() holds jsdom's own timer queue back, while Node timers
  // keep firing. Shim the window timer pair onto Node timers so the
  // composer's 60ms focus-retry loop actually ticks during the await.
  const nodeIntervalHandles = new Map();
  let nextIntervalId = 1;
  dom.window.setInterval = (fn, ms) => {
    const id = nextIntervalId++;
    nodeIntervalHandles.set(id, setInterval(fn, ms));
    return id;
  };
  dom.window.clearInterval = (id) => {
    const handle = nodeIntervalHandles.get(id);
    if (handle) {
      clearInterval(handle);
      nodeIntervalHandles.delete(id);
    }
  };
  const globalsSnapshot = new Map(
    ["window", "document", "HTMLElement", "Node", "Event", "MouseEvent",
      "IS_REACT_ACT_ENVIRONMENT", "localStorage", "React"].map((key) => [
      key,
      Object.prototype.hasOwnProperty.call(global, key),
    ]),
  );
  const previousGlobals = Object.fromEntries(
    [...globalsSnapshot].map(([key, existed]) => [key, global[key]]),
  );
  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: dom.window.localStorage,
    // jiti compiles the container's JSX to the classic runtime.
    React,
  });

  explicitOpenAt = primedOpenAt;
  explicitOpenAtWrites = [];
  const otherField = dom.window.document.getElementById("other-field");
  if (focusAnotherField) otherField.focus();
  const reactRoot = createRoot(dom.window.document.getElementById("root"));
  try {
    // Mount effects flush here; the retry loop is scheduled.
    await act(async () => {
      reactRoot.render(
        React.createElement(
          MobileViewContext.Provider,
          { value: false },
          React.createElement(
            TestChatContext.Provider,
            { value: chatContextValue },
            React.createElement(AI_Tiptap_Container),
          ),
        ),
      );
    });
    // React 19's act defers timer callbacks until it exits, so the loop can
    // only tick in this plain await. The loop touches nothing but the DOM.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const composer = dom.window.document.querySelector(".ProseMirror");
    return {
      activeElement: dom.window.document.activeElement,
      composer,
      otherField,
      writes: explicitOpenAtWrites,
    };
  } finally {
    await act(async () => {
      reactRoot.unmount();
    });
    Object.assign(global, previousGlobals);
    for (const [key, existed] of globalsSnapshot) {
      if (!existed && Object.prototype.hasOwnProperty.call(global, key)) {
        delete global[key];
      }
    }
  }
};

test("an explicit open mounts the composer focused and consumes the request", async () => {
  const { activeElement, composer, writes } = await mountComposer(Date.now());
  assert.equal(activeElement, composer, "composer should take the cursor");
  assert.deepEqual(writes, [null], "fresh request must be consumed once");
});

test("auto-open mounts the composer unfocused", async () => {
  const { activeElement, composer, writes } = await mountComposer(null);
  assert.notEqual(activeElement, composer, "auto-open must not steal the cursor");
  assert.deepEqual(writes, [], "no request to consume");
});

test("a delayed explicit open does not steal focus from another field", async () => {
  const { activeElement, otherField, writes } = await mountComposer(Date.now(), true);
  assert.equal(activeElement, otherField, "the field must keep the cursor");
  assert.deepEqual(writes, [null], "fresh request must still be consumed");
});

test("a stale explicit request no longer claims focus", async () => {
  const { activeElement, composer, writes } = await mountComposer(
    Date.now() - 6000
  );
  assert.notEqual(activeElement, composer, "expired request must not focus");
  assert.deepEqual(writes, [], "stale request is left alone");
});
