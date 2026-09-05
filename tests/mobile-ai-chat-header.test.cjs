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
const TestChatContext = React.createContext(undefined);
const toastErrors = [];

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

stubModule(require.resolve("next/navigation"), {
  useRouter: () => ({ push: () => {} }),
});
stubModule(require.resolve("react-hot-toast"), {
  default: { error: (message) => toastErrors.push(message) },
});
stubSourceModule(
  "src/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context.tsx",
  {
    useAiChatContext: () => React.useContext(TestChatContext),
  },
);
stubSourceModule("src/components/Common/Tooltip.tsx", {
  default: () => null,
});
stubSourceModule("src/lib/contexts/deviceContext.tsx", {
  useDeviceContext: () => false,
});
stubSourceModule("src/lib/configs/aiTaskWriter.config.ts", {
  aiTaskWriterConfig: {
    shortcutsAndTooltips: { ai_chat: { new_chat_button: () => ({}) } },
  },
});
stubSourceModule("src/components/Global/ModelSelectorDropdown.tsx", {
  default: () => React.createElement("button", { "data-control": "model" }),
  getMobileAiChatModelLabel: () => "5.6 Luna · High",
});
stubSourceModule("src/lib/state.tsx", {
  useRecoilState: () => [false, () => {}],
});
stubSourceModule("src/store/index.ts", {
  aiChatAutoOpenSuppressedAtom: {},
  aiChatPinnedAtom: {},
  showAIChatInterfaceAtom: {},
});

const { MobileViewContext } = jiti(
  path.join(root, "src/lib/contexts/mobileContext.tsx"),
);
const { ChatHeader } = jiti(
  path.join(root, "src/components/AI_CHAT/ChatHeader.tsx"),
);

for (const filename of Object.keys(require.cache)) {
  if (!originalCache.has(filename)) delete require.cache[filename];
}
for (const [filename, cachedModule] of originalCache) {
  require.cache[filename] = cachedModule;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("mobile new chat blocks repeated requests and recovers after rejection", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://app.hypertask.ai/project",
  });
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousNavigator = global.navigator;
  const previousReact = global.React;
  const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.React = React;
  global.IS_REACT_ACT_ENVIRONMENT = true;

  let request = deferred();
  let requestCount = 0;
  const context = {
    togglePopover: () => {},
    minimizeChat: () => {},
    toggleSidebarMode: () => {},
    isSidebarMode: true,
    sessions: [
      {
        id: "first",
        title: "First chat",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "active",
        title: "Active chat",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    activeSession: "active",
    currentSession: {
      id: "active",
      title: "Active chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    startNewSession: () => {
      requestCount += 1;
      return request.promise;
    },
    selectSession: () => {},
    toggleRenameChatModal: () => {},
    deleteSession: () => {},
    editor: { view: { dom: { focus: () => {} } } },
    dropDownButtonAICallback: () => {},
    currentAiOption: { id: "gpt-5.6-luna-high" },
    displayAiOptions: [],
  };
  const container = document.getElementById("root");
  const reactRoot = createRoot(container);
  const renderHeader = () =>
    React.createElement(
      MobileViewContext.Provider,
      { value: true },
      React.createElement(
        TestChatContext.Provider,
        { value: context },
        React.createElement(ChatHeader),
      ),
    );

  try {
    toastErrors.length = 0;
    await act(async () => reactRoot.render(renderHeader()));
    assert.match(container.textContent, /Active chat/);
    assert.doesNotMatch(container.textContent, /First chat/);
    assert.match(
      container.querySelector("[data-ai-chat-mobile-model-label]").textContent,
      /5\.6 Luna · High/,
    );
    assert.equal(
      container.querySelector('[data-control="model"]'),
      null,
      "the header model line must not mount a second selector",
    );

    const newChatButton = container.querySelector('[aria-label="New chat"]');
    assert.ok(newChatButton);
    await act(async () => {
      newChatButton.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
      newChatButton.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true }),
      );
    });
    assert.equal(requestCount, 1);
    assert.equal(newChatButton.disabled, true);

    await act(async () => {
      request.reject(new Error("request failed"));
      await Promise.resolve();
    });
    assert.equal(newChatButton.disabled, false);
    assert.equal(toastErrors.length, 1);

    request = deferred();
    await act(async () => newChatButton.click());
    assert.equal(requestCount, 2);
    assert.equal(newChatButton.disabled, true);
    await act(async () => {
      request.resolve();
      await Promise.resolve();
    });
    assert.equal(newChatButton.disabled, false);
  } finally {
    await act(async () => reactRoot.unmount());
    global.window = previousWindow;
    global.document = previousDocument;
    global.navigator = previousNavigator;
    global.React = previousReact;
    global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    dom.window.close();
  }
});
