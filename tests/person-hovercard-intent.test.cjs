const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { JSDOM } = require("jsdom");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.resolve(__dirname, "..");
const hovercardPath = path.join(
  root,
  "src/components/Common/PersonHovercard.tsx",
);
const avatarPath = path.join(root, "src/components/Common/UserAvatar.tsx");
const hookPath = path.join(
  root,
  "src/hooks/MultiPages/usePersonHovercard.ts",
);
const pageHrefPath = path.join(root, "src/lib/agents/pageHref.ts");

const stubModule = (filename, exports) => {
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

test("assignee hovercards require intentional hover but open on keyboard focus", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousNavigator = global.navigator;
  const previousReact = global.React;
  const previousHTMLElement = global.HTMLElement;
  const previousElement = global.Element;
  const previousNode = global.Node;
  const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  const previousModules = new Map(
    [avatarPath, hookPath, pageHrefPath, require.resolve("@floating-ui/react")].map(
      (filename) => [filename, require.cache[filename]],
    ),
  );
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://app.hypertask.ai/detail/project-15/6578",
  });
  let reactRoot;
  let descriptionClicks = 0;

  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    global.React = React;
    global.HTMLElement = dom.window.HTMLElement;
    global.Element = dom.window.Element;
    global.Node = dom.window.Node;
    global.IS_REACT_ACT_ENVIRONMENT = true;

    stubModule(avatarPath, { default: () => null });
    stubModule(hookPath, {
      usePersonHovercard: () => ({ isFetching: true, isError: false }),
    });
    stubModule(pageHrefPath, { agentPageHref: () => null });
    stubModule(require.resolve("@floating-ui/react"), {
      autoUpdate: () => {},
      flip: () => ({}),
      FloatingFocusManager: ({ children }) => children,
      FloatingPortal: ({ children }) => children,
      offset: () => ({}),
      safePolygon: () => () => {},
      shift: () => ({}),
      useDismiss: () => ({}),
      useFloating: () => ({
        context: {},
        floatingStyles: {},
        refs: { setFloating: () => {}, setReference: () => {} },
      }),
      useFocus: () => ({}),
      useHover: () => ({}),
      useInteractions: () => ({
        getFloatingProps: (props) => props,
        getReferenceProps: (props) => props,
      }),
      useRole: () => ({}),
    });

    const jiti = jitiModule.createJiti
      ? jitiModule.createJiti(__filename, {
          interopDefault: true,
          jsx: true,
          alias: { "@": path.join(root, "src") },
        })
      : jitiModule(__filename, {
          interopDefault: true,
          jsx: true,
          alias: { "@": path.join(root, "src") },
        });
    const { ParentPersonHovercard } = jiti(hovercardPath);
    const container = document.getElementById("root");
    reactRoot = require("react-dom/client").createRoot(container);
    await React.act(async () => {
      reactRoot.render(
        React.createElement(
          "div",
          null,
          React.createElement(
            "button",
            { type: "button" },
            React.createElement(ParentPersonHovercard, {
              projectId: 15,
              subject: { kind: "agent", id: "verification-fleet" },
            }),
            "verification-fleet",
          ),
          React.createElement(
            "button",
            {
              type: "button",
              onClick: () => {
                descriptionClicks += 1;
              },
            },
            "Add Description",
          ),
        ),
      );
    });
    const [trigger, description] = container.querySelectorAll("button");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");

    await React.act(async () => {
      trigger.dispatchEvent(new window.Event("pointerenter"));
    });
    assert.equal(trigger.getAttribute("aria-expanded"), "false");

    await React.act(async () => {
      trigger.dispatchEvent(new window.Event("pointerleave"));
      description.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await wait(350);
    });
    assert.equal(descriptionClicks, 1);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");

    await React.act(async () => {
      trigger.dispatchEvent(new window.Event("pointerenter"));
      await wait(350);
    });
    assert.equal(trigger.getAttribute("aria-expanded"), "true");

    await React.act(async () => {
      trigger.dispatchEvent(new window.Event("pointerleave"));
      await wait(120);
    });
    assert.equal(trigger.getAttribute("aria-expanded"), "false");

    await React.act(async () => {
      trigger.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));
    });
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom.window.close();
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousNavigator === undefined) delete global.navigator;
    else global.navigator = previousNavigator;
    if (previousReact === undefined) delete global.React;
    else global.React = previousReact;
    if (previousHTMLElement === undefined) delete global.HTMLElement;
    else global.HTMLElement = previousHTMLElement;
    if (previousElement === undefined) delete global.Element;
    else global.Element = previousElement;
    if (previousNode === undefined) delete global.Node;
    else global.Node = previousNode;
    if (previousActEnvironment === undefined) delete global.IS_REACT_ACT_ENVIRONMENT;
    else global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    for (const [filename, previousModule] of previousModules) {
      if (previousModule === undefined) delete require.cache[filename];
      else require.cache[filename] = previousModule;
    }
    delete require.cache[hovercardPath];
  }
});
