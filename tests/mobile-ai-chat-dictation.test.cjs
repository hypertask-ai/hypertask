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
const { mobileMicPresentation } = jiti(
  path.join(
    root,
    "src/components/RTE/Components/mobileAudioButtonPresentation.ts",
  ),
);
const originalCache = new Map(Object.entries(require.cache));
const TestChatContext = React.createContext(undefined);
let pathname = "/project";

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
  usePathname: () => pathname,
});
stubSourceModule("src/components/Global/ModelSelectorDropdown.tsx", {
  default: () => React.createElement("button", { "data-control": "model" }),
});
stubSourceModule("src/components/Common/Tooltip.tsx", {
  default: () => null,
});
stubModule(require.resolve("react-hot-toast"), {
  default: { error: () => {} },
});
stubSourceModule("src/lib/configs/aiTaskWriter.config.ts", {
  aiTaskWriterConfig: {
    fontSizes: { moderateIcon: 18 },
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
const { AudioButton: RealAudioButton } = jiti(
  path.join(root, "src/components/RTE/Components/AudioButton.tsx"),
);
stubSourceModule("src/components/RTE/Components/AudioButton.tsx", {
  default: ({
    wrapperClassName,
    visualizerClassName,
    globalRecording,
    hasText,
    onProcessingChange,
  }) =>
    React.createElement("button", {
      className: ["audio-recorder", wrapperClassName, visualizerClassName]
        .filter(Boolean)
        .join(" "),
      "data-control": "recorder",
      "data-global-recording": String(globalRecording),
      "data-has-text": String(hasText),
      onClick: () => onProcessingChange?.(true),
    }),
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

const chatContextValue = (isRecording, isEmpty = true, overrides = {}) => ({
  tiptapKeydown: () => {},
  editor: { isEmpty },
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
  ...overrides,
});

const renderComposer = (isRecording, isEmpty = true, overrides = {}) =>
  React.createElement(
    MobileViewContext.Provider,
    { value: true },
    React.createElement(
      TestChatContext.Provider,
      { value: chatContextValue(isRecording, isEmpty, overrides) },
      React.createElement(AI_Tiptap_Container),
    ),
  );

test("mobile AI chat uses the filled 44px mic and demotes it once text exists", () => {
  const base = {
    isMobileCreateComment: false,
    isMobileTaskWriter: false,
    isMobileNewTask: false,
    isMobileAiChat: true,
    isProcessing: false,
  };
  const empty = mobileMicPresentation(base);
  assert.equal(empty.prominent, true);
  assert.match(empty.className, /h-11 w-11/);
  assert.match(empty.className, /rounded-full/);
  assert.match(empty.className, /bg-shadcn-primary/);

  const typed = mobileMicPresentation({ ...base, hasText: true });
  assert.equal(typed.prominent, true);
  assert.match(typed.className, /h-11 w-11/);
  assert.match(typed.className, /text-icon-dark-gray/);
  assert.doesNotMatch(typed.className, /bg-shadcn-primary/);

  const recording = mobileMicPresentation({
    ...base,
    globalRecording: true,
  });
  assert.equal(recording.prominent, false);

  const processing = mobileMicPresentation({
    ...base,
    isProcessing: true,
  });
  assert.equal(processing.className, "h-[34px] gap-2");
});

test("real mobile microphones apply each composer presentation state", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://app.hypertask.ai/chat",
  });
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousLocalStorage = global.localStorage;
  const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.IS_REACT_ACT_ENVIRONMENT = true;

  const container = document.getElementById("root");
  const reactRoot = createRoot(container);
  const renderMic = (id, hasText, globalRecording = false) =>
    React.createElement(
      MobileViewContext.Provider,
      { value: true },
      React.createElement(RealAudioButton, {
        callbackHandler: () => {},
        editor: null,
        globalRecording,
        hasText,
        id,
        toggleRecording: () => {},
      }),
    );
  const modes = [
    {
      id: "create-comment-audio-button",
      shape: /rounded-sm/,
      fill: /bg-hypertasks-ai-purple/,
    },
    {
      id: "ai-writer-audio-button",
      shape: /rounded-sm/,
      fill: /bg-shadcn-primary/,
    },
    {
      id: "create-task-modal-audio-button",
      shape: /rounded-sm/,
      fill: /bg-shadcn-primary/,
    },
    {
      id: "ai-chat-audio-button",
      shape: /rounded-full/,
      fill: /bg-shadcn-primary/,
    },
  ];

  try {
    for (const { id, shape, fill } of modes) {
      await act(async () => reactRoot.render(renderMic(id, false)));
      const mic = container.querySelector(`#${id}`);
      assert.ok(mic);
      assert.match(mic.className, /h-11 w-11/);
      assert.match(mic.className, shape);
      assert.match(mic.className, fill);

      await act(async () => reactRoot.render(renderMic(id, true)));
      assert.match(mic.className, /text-icon-dark-gray/);
      assert.doesNotMatch(mic.className, fill);
    }

    await act(async () =>
      reactRoot.render(renderMic("ai-chat-audio-button", true, true)),
    );
    const recordingMic = container.querySelector("#ai-chat-audio-button");
    assert.match(recordingMic.className, /h-\[32px\]/);
    assert.doesNotMatch(recordingMic.className, /h-11 w-11/);
  } finally {
    pathname = "/project";
    await act(async () => reactRoot.unmount());
    dom.window.close();
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousLocalStorage === undefined) delete global.localStorage;
    else global.localStorage = previousLocalStorage;
    if (previousActEnvironment === undefined) {
      delete global.IS_REACT_ACT_ENVIRONMENT;
    } else {
      global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
});

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
    pathname = "/chat";
    await act(async () => reactRoot.render(renderComposer(false, true)));
    assert.ok(container.querySelector("[data-ai-chat-mobile-context-row]"));
    assert.equal(
      container.querySelector("[data-ai-chat-mobile-scope]"),
      null,
      "standalone chat must not show project scope",
    );
    assert.ok(container.querySelector('[data-control="recorder"]'));
    assert.ok(container.querySelector("[data-ai-chat-mobile-overflow]"));

    pathname = "/project";
    let screenshotUploads = 0;
    await act(async () =>
      reactRoot.render(
        renderComposer(false, true, {
          handleFileUpload: async () => {
            screenshotUploads += 1;
          },
        }),
      ),
    );
    const recorderBefore = container.querySelector('[data-control="recorder"]');
    const overflow = container.querySelector("[data-ai-chat-mobile-overflow]");
    assert.ok(recorderBefore);
    assert.ok(overflow);
    assert.equal(recorderBefore.dataset.hasText, "false");
    assert.equal(recorderBefore.dataset.globalRecording, "false");
    assert.match(recorderBefore.className, /order-4 ml-auto/);
    assert.equal(
      container.querySelector("[data-ai-chat-leading-controls]"),
      null,
      "mobile must not mount the desktop model and scope controls",
    );
    assert.ok(container.querySelector("[data-ai-chat-mobile-context-row]"));
    assert.ok(container.querySelector("[data-ai-chat-mobile-scope]"));
    assert.ok(container.querySelector("[data-ai-chat-mobile-add-context]"));
    assert.equal(overflow.hidden, false);
    const overflowActions = overflow
      .querySelector('[role="group"]')
      .querySelectorAll("button");
    assert.equal(
      overflowActions.length,
      3,
      "attachment, context, and screenshot controls belong inside the + overflow",
    );
    assert.match(
      overflow.querySelector("summary").className,
      /h-11 w-11/,
      "the + trigger must keep a 44px touch target",
    );
    const screenshotInput = container.querySelector(
      "#ai-chat-screenshot-upload",
    );
    assert.equal(
      screenshotInput.accept,
      "image/png,image/jpeg,image/webp",
    );
    Object.defineProperty(screenshotInput, "files", {
      configurable: true,
      value: [new dom.window.File(["gif"], "not-a-screenshot.gif", { type: "image/gif" })],
    });
    await act(async () =>
      screenshotInput.dispatchEvent(new dom.window.Event("change", { bubbles: true })),
    );
    assert.equal(screenshotUploads, 0, "unsupported image types must be rejected");
    Object.defineProperty(screenshotInput, "files", {
      configurable: true,
      value: [new dom.window.File(["png"], "screenshot.png", { type: "image/png" })],
    });
    await act(async () =>
      screenshotInput.dispatchEvent(new dom.window.Event("change", { bubbles: true })),
    );
    assert.equal(screenshotUploads, 1, "supported screenshots use the existing draft path");
    overflow.open = true;
    await act(async () => overflowActions[0].click());
    assert.equal(overflow.open, false, "an action must close the overflow");

    overflow.open = true;
    document.body.dispatchEvent(
      new dom.window.Event("pointerdown", { bubbles: true }),
    );
    assert.equal(overflow.open, false, "an outside tap must close the overflow");

    overflow.open = true;
    document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert.equal(overflow.open, false, "Escape must close the overflow");
    assert.equal(container.querySelector("[data-ai-chat-primary-send]"), null);

    await act(async () => reactRoot.render(renderComposer(false, false)));
    const recorderWithText = container.querySelector('[data-control="recorder"]');
    assert.strictEqual(
      recorderWithText,
      recorderBefore,
      "typing must move, not remount, the recorder",
    );
    assert.equal(recorderWithText.dataset.hasText, "true");
    assert.equal(recorderWithText.dataset.globalRecording, "false");
    assert.match(recorderWithText.className, /order-3 ml-auto/);
    const primarySend = container.querySelector(
      "[data-ai-chat-primary-send] button",
    );
    assert.ok(primarySend);
    assert.match(primarySend.className, /h-11 w-11/);
    assert.match(primarySend.className, /rounded-full/);
    assert.match(primarySend.className, /bg-shadcn-primary/);
    assert.equal(primarySend.querySelector("svg")?.getAttribute("viewBox"), "0 0 105 105");

    overflow.open = true;
    await act(async () => reactRoot.render(renderComposer(true, false)));
    assert.equal(overflow.open, false, "dictation must close the overflow");
    const recorderAfter = container.querySelector('[data-control="recorder"]');
    assert.strictEqual(
      recorderAfter,
      recorderBefore,
      "recording state must not remount the recorder",
    );
    assert.equal(recorderAfter.dataset.globalRecording, "true");
    assert.equal(
      container.querySelector("[data-ai-chat-leading-controls]"),
      null,
    );
    assert.equal(
      container.querySelector("[data-ai-chat-mobile-overflow]").hidden,
      true,
    );
    assert.equal(container.querySelector("[data-ai-chat-primary-send]"), null);
    assert.match(
      container.querySelector("[data-ai-chat-recorder-row]").className,
      /min-w-0 flex-1/,
    );
    assert.match(recorderAfter.className, /min-w-0 flex-1/);
    assert.match(recorderAfter.className, /!mb-0 min-w-0 w-full/);

    await act(async () => reactRoot.render(renderComposer(false, false)));
    await act(async () => recorderAfter.click());
    assert.strictEqual(
      container.querySelector('[data-control="recorder"]'),
      recorderBefore,
      "transcription state must not remount the recorder",
    );
    assert.equal(
      container.querySelector("[data-ai-chat-leading-controls]"),
      null,
    );
  } finally {
    pathname = "/project";
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
