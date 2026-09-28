const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { hydrateRoot } = require("react-dom/client");
const { renderToString } = require("react-dom/server");
const {
  QueryClient,
  QueryClientProvider,
} = require("@tanstack/react-query");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const atoms = {
  currentProjectAtom: Symbol("currentProjectAtom"),
  inViewObjectAtom: Symbol("inViewObjectAtom"),
  taskDetailNonEssentialReadyAtom: Symbol("taskDetailNonEssentialReadyAtom"),
};

const stubModule = (filename, exports) => {
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
};

test("AI welcome suggestions hydrate before using browser board data", async () => {
  const originalLoad = Module._load;
  const originalRandom = Math.random;
  const previousGlobals = {
    window: global.window,
    document: global.document,
    navigator: global.navigator,
    React: global.React,
    actEnvironment: global.IS_REACT_ACT_ENVIRONMENT,
  };
  const stubbedModules = new Map([
    [
      path.join(
        root,
        "src/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context.tsx",
      ),
      {
        useAiChatContext: () => ({
          handleSendMessage: () => {},
          isDetailPage: false,
          selectSession: () => {},
          editor: null,
        }),
      },
    ],
    [
      path.join(root, "src/lib/state.tsx"),
      {
        useRecoilValue: (atom) => {
          if (atom === atoms.currentProjectAtom) {
            if (typeof global.window === "undefined") return null;
            return {
              id: 1,
              title: "QA runner board",
              sections: [
                {
                  id: 10,
                  section_title: "Todo",
                  deleted: false,
                  items: [
                    {
                      id: 100,
                      status: "Normal",
                      assignees: [],
                    },
                  ],
                },
              ],
            };
          }
          if (atom === atoms.inViewObjectAtom) return null;
          if (atom === atoms.taskDetailNonEssentialReadyAtom) return true;
          return null;
        },
      },
    ],
    [path.join(root, "src/store/index.ts"), atoms],
    [
      path.join(root, "src/lib/demo/isGuestClient.ts"),
      { isGuestCookieUser: () => false },
    ],
    [
      path.join(root, "src/lib/demo/guestBoardBuild.ts"),
      { isGuestBoardBuild: () => false },
    ],
    [
      path.join(root, "src/components/AI_CHAT/GuestBoardSpotlight.tsx"),
      { GuestBoardSpotlight: () => null },
    ],
    [
      path.join(root, "src/utils/generateTime.ts"),
      { __esModule: true, default: () => "" },
    ],
    [
      path.join(root, "src/components/AI_CHAT/taskSummaryAction.ts"),
      { taskSummaryActionFor: () => null },
    ],
  ]);
  const previousModules = new Map(
    [...stubbedModules.keys()].map((filename) => [
      filename,
      require.cache[filename],
    ]),
  );
  let reactRoot;
  let dom;

  Module._load = (request, parent, isMain) => {
    if (request === "next/navigation") {
      return { usePathname: () => "/project?id=1" };
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    for (const [filename, exports] of stubbedModules) {
      stubModule(filename, exports);
    }
    delete global.window;
    delete global.document;
    delete global.navigator;
    global.React = React;
    Math.random = () => 0.5;

    const jiti = createJiti(__filename, {
      interopDefault: true,
      jsx: true,
      alias: { "@": path.join(root, "src") },
    });
    const { WelcomeScreen } = jiti(
      path.join(root, "src/components/AI_CHAT/WelcomeScreen.tsx"),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const renderWelcomeScreen = () =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(WelcomeScreen),
      );
    const serverHtml = renderToString(renderWelcomeScreen());

    dom = new JSDOM(`<div id="root">${serverHtml}</div>`, {
      url: "https://app.hypertask.ai/project?id=1",
    });
    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    global.IS_REACT_ACT_ENVIRONMENT = true;

    const recoverableErrors = [];
    const container = dom.window.document.getElementById("root");
    reactRoot = hydrateRoot(
      container,
      renderWelcomeScreen(),
      {
        onRecoverableError: (error) => recoverableErrors.push(error),
      },
    );

    await React.act(async () => {});

    assert.deepEqual(
      recoverableErrors,
      [],
      "board-aware prompts must wait until the server markup has hydrated",
    );
    assert.match(container.textContent, /What's important in my inbox\?/);
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom?.window.close();
    Module._load = originalLoad;
    Math.random = originalRandom;
    for (const [filename, previous] of previousModules) {
      if (previous === undefined) delete require.cache[filename];
      else require.cache[filename] = previous;
    }
    if (previousGlobals.window === undefined) delete global.window;
    else global.window = previousGlobals.window;
    if (previousGlobals.document === undefined) delete global.document;
    else global.document = previousGlobals.document;
    if (previousGlobals.navigator === undefined) delete global.navigator;
    else global.navigator = previousGlobals.navigator;
    if (previousGlobals.React === undefined) delete global.React;
    else global.React = previousGlobals.React;
    if (previousGlobals.actEnvironment === undefined) {
      delete global.IS_REACT_ACT_ENVIRONMENT;
    } else {
      global.IS_REACT_ACT_ENVIRONMENT = previousGlobals.actEnvironment;
    }
  }
});
