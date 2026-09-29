const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { hydrateRoot } = require("react-dom/client");
const { renderToString } = require("react-dom/server");

const root = path.join(__dirname, "..");
const statePath = path.join(root, "src/lib/state.tsx");
const storePath = path.join(root, "src/store/index.ts");

const loadModule = (modulePath) =>
  require("jiti")(__filename, {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
    cache: false,
    jsx: { runtime: "automatic", importSource: "react" },
  })(modulePath);

const loadState = () => loadModule(statePath);
const loadStore = () => loadModule(storePath);

const createPersistedValue = (state) => {
  const { persistAtom } = state.recoilPersist();
  return state.atom({
    key: "hydration-test-value",
    default: "server-default",
    effects_UNSTABLE: [persistAtom],
  });
};

test("persisted atoms keep their server default through hydration", async () => {
  const serverState = loadState();
  const serverStore = loadStore();
  const serverValue = createPersistedValue(serverState);
  const ServerView = () =>
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "strong",
        null,
        serverState.useRecoilValue(serverValue),
      ),
      React.createElement(
        "span",
        null,
        serverState.useRecoilValue(serverStore.currentUserAtom)
          ? "signed-in"
          : "guest",
      ),
      React.createElement(
        "em",
        null,
        serverState.useRecoilValue(serverStore.appShellRailAtom)
          ? "rail-on"
          : "rail-off",
      ),
    );
  const serverTree = React.createElement(
    serverState.StateRoot,
    null,
    React.createElement(ServerView),
  );
  const serverMarkup = renderToString(serverTree);
  assert.equal(
    serverMarkup,
    "<strong>server-default</strong><span>guest</span><em>rail-on</em>",
  );

  const dom = new JSDOM(`<div id="root">${serverMarkup}</div>`, {
    url: "https://app.hypertask.ai/inbox",
  });
  dom.window.localStorage.setItem(
    "recoil-persist",
    JSON.stringify({
      "hydration-test-value": "browser-saved",
      currentUser: { id: 999, displayName: "Stale Browser User" },
      appShellRail: false,
    }),
  );

  const testGlobals = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    StorageEvent: dom.window.StorageEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previousGlobals = new Map(
    Object.keys(testGlobals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(global, key),
    ]),
  );
  for (const [key, value] of Object.entries(testGlobals)) {
    Object.defineProperty(global, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  const clientState = loadState();
  const clientStore = loadStore();
  const clientValue = createPersistedValue(clientState);
  const ClientView = () =>
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "strong",
        null,
        clientState.useRecoilValue(clientValue),
      ),
      React.createElement(
        "span",
        null,
        clientState.useRecoilValue(clientStore.currentUserAtom)
          ? "signed-in"
          : "guest",
      ),
      React.createElement(
        "em",
        null,
        clientState.useRecoilValue(clientStore.appShellRailAtom)
          ? "rail-on"
          : "rail-off",
      ),
    );
  const clientTree = React.createElement(
    clientState.StateRoot,
    null,
    React.createElement(ClientView),
  );

  const recoverableErrors = [];
  let hydratedRoot;
  try {
    await React.act(async () => {
      hydratedRoot = hydrateRoot(
        dom.window.document.getElementById("root"),
        clientTree,
        { onRecoverableError: (error) => recoverableErrors.push(error) },
      );
    });

    assert.equal(recoverableErrors.length, 0);
    assert.equal(
      dom.window.document.querySelector("strong")?.textContent,
      "browser-saved",
    );
    assert.equal(
      dom.window.document.querySelector("span")?.textContent,
      "guest",
    );
    assert.equal(
      dom.window.document.querySelector("em")?.textContent,
      "rail-off",
    );
  } finally {
    if (hydratedRoot) {
      await React.act(async () => hydratedRoot.unmount());
    }
    dom.window.close();
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
});
