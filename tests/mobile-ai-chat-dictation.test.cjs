const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/mobile-ai-chat-dictation.test.cjs"),
  {
    interopDefault: true,
    jsx: true,
    alias: { "@": path.join(root, "src") },
  },
);
const originalCache = new Map(Object.entries(require.cache));
const TestChatContext = React.createContext(undefined);

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

stubModule(require.resolve("@tiptap/react"), {
  EditorContent: () => React.createElement("div", { "data-editor": true }),
  useEditorState: ({ editor, selector }) => selector({ editor }),
});
stubModule(require.resolve("next/navigation"), {
  usePathname: () => "/chat",
});
stubSourceModule("src/components/Global/ModelSelectorDropdown.tsx", {
  default: () => React.createElement("button", { "data-control": "model" }),
});
stubSourceModule("src/components/Common/Tooltip.tsx", {
  default: () => null,
});
stubSourceModule("src/lib/configs/aiTaskWriter.config.ts", {
  aiTaskWriterConfig: {
    shortcutsAndTooltips: {
      ai_chat: {
        attachment_button: () => ({}),
        cancel_stream_button: {},
        send_button: {},
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
stubSourceModule("src/components/RTE/Components/AudioButton.tsx", {
  default: ({ wrapperClassName, visualizerClassName }) =>
    React.createElement("div", {
      className: ["audio-recorder", wrapperClassName, visualizerClassName]
        .filter(Boolean)
        .join(" "),
      "data-control": "recorder",
    }),
});
stubSourceModule(
  "src/components/Common/AttachmentsUpload/ImageGalleryView.tsx",
  { default: () => null },
);
stubSourceModule("src/lib/contexts/deviceContext.tsx", {
  useDeviceContext: () => false,
});
stubSourceModule("src/lib/state.tsx", {
  useRecoilState: () => [null, () => {}],
  useRecoilValue: () => null,
});
stubSourceModule("src/store/index.ts", {
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
const { AI_Tiptap_Container } = jiti(
  path.join(root, "src/components/AI_CHAT/AI_Tiptap_Container.tsx"),
);

for (const filename of Object.keys(require.cache)) {
  if (!originalCache.has(filename)) delete require.cache[filename];
}
for (const [filename, cachedModule] of originalCache) {
  require.cache[filename] = cachedModule;
}

const chatContextValue = (isRecording) => ({
  tiptapKeydown: () => {},
  editor: null,
  isTyping: false,
  isRecording,
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
});

const renderComposer = (isRecording) =>
  React.createElement(
    MobileViewContext.Provider,
    { value: true },
    React.createElement(
      TestChatContext.Provider,
      { value: chatContextValue(isRecording) },
      React.createElement(AI_Tiptap_Container),
    ),
  );

test("mobile composer follows live recording state without remounting recorder", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousReact = global.React;
  const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  global.window = dom.window;
  global.document = dom.window.document;
  global.React = React;
  global.IS_REACT_ACT_ENVIRONMENT = true;

  const container = document.getElementById("root");
  const reactRoot = createRoot(container);

  try {
    await act(async () => reactRoot.render(renderComposer(false)));
    const recorderBefore = container.querySelector('[data-control="recorder"]');
    assert.ok(recorderBefore);
    assert.equal(
      container.querySelector("[data-ai-chat-leading-controls]").hidden,
      false,
    );
    assert.equal(
      container.querySelector("[data-ai-chat-before-recorder]").hidden,
      false,
    );
    assert.equal(
      container.querySelector("[data-ai-chat-after-recorder]").hidden,
      false,
    );

    await act(async () => reactRoot.render(renderComposer(true)));
    const recorderAfter = container.querySelector('[data-control="recorder"]');
    assert.strictEqual(
      recorderAfter,
      recorderBefore,
      "recording state must not remount the recorder",
    );
    assert.equal(
      container.querySelector("[data-ai-chat-leading-controls]").hidden,
      true,
    );
    assert.equal(
      container.querySelector("[data-ai-chat-before-recorder]").hidden,
      true,
    );
    assert.equal(
      container.querySelector("[data-ai-chat-after-recorder]").hidden,
      true,
    );
    assert.match(
      container.querySelector("[data-ai-chat-recorder-row]").className,
      /min-w-0 flex-1/,
    );
    assert.match(recorderAfter.className, /min-w-0 flex-1/);
    assert.match(recorderAfter.className, /!mb-0 min-w-0 w-full/);
  } finally {
    await act(async () => reactRoot.unmount());
    dom.window.close();
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousReact === undefined) delete global.React;
    else global.React = previousReact;
    if (previousActEnvironment === undefined) {
      delete global.IS_REACT_ACT_ENVIRONMENT;
    } else {
      global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
});
