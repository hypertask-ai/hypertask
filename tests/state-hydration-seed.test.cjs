const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { hydrateRoot } = require("react-dom/client");
const { renderToString } = require("react-dom/server");

const root = path.join(__dirname, "..");
const jiti = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  cache: false,
  jsx: { runtime: "automatic", importSource: "react" },
});
const { StateRoot, useRecoilValue, useSetRecoilState } = jiti(
  path.join(root, "src/lib/state.tsx"),
);
const { currentUserAtom } = jiti(path.join(root, "src/store/index.ts"));

const user = {
  id: 42,
  displayName: "Hydration User",
  email: "hydration@example.com",
};

function CurrentUserBranch() {
  const currentUser = useRecoilValue(currentUserAtom);
  return React.createElement(
    "div",
    null,
    currentUser
      ? React.createElement("strong", null, currentUser.displayName)
      : React.createElement("span", null, "Guest"),
  );
}

function EarlyUserPublisher() {
  const setCurrentUser = useSetRecoilState(currentUserAtom);
  React.useLayoutEffect(() => {
    setCurrentUser({ ...user, notificationPreference: "direct" });
  }, [setCurrentUser]);
  return null;
}

function appTree(Route) {
  return React.createElement(
    StateRoot,
    { initialValues: [[currentUserAtom, user]] },
    React.createElement(EarlyUserPublisher),
    React.createElement(
      React.Suspense,
      { fallback: React.createElement("i", null, "Loading") },
      React.createElement(Route),
    ),
  );
}

test("server-seeded user state protects a late hydration boundary", async () => {
  const markup = renderToString(appTree(CurrentUserBranch));
  assert.match(markup, /<strong>Hydration User<\/strong>/);

  let resolveRoute;
  const LateCurrentUserBranch = React.lazy(
    () =>
      new Promise((resolve) => {
        resolveRoute = () => resolve({ default: CurrentUserBranch });
      }),
  );
  const dom = new JSDOM(`<div id="root">${markup}</div>`, {
    url: "https://app.hypertask.ai/inbox",
  });
  const testGlobals = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
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

  const recoverableErrors = [];
  let hydratedRoot;
  try {
    await React.act(async () => {
      hydratedRoot = hydrateRoot(
        dom.window.document.getElementById("root"),
        appTree(LateCurrentUserBranch),
        { onRecoverableError: (error) => recoverableErrors.push(error) },
      );
    });
    await React.act(async () => resolveRoute());

    assert.equal(recoverableErrors.length, 0);
    assert.equal(
      dom.window.document.querySelector("strong")?.textContent,
      "Hydration User",
    );
  } finally {
    if (hydratedRoot) await React.act(async () => hydratedRoot.unmount());
    dom.window.close();
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
});
