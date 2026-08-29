const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { JSDOM } = require("jsdom");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.resolve(__dirname, "..");
const contextPath = path.join(
  root,
  "src/lib/contexts/TaskDetail/TaskProvider.tsx",
);
const clickOutsidePath = path.join(
  root,
  "src/hooks/MultiPages/useClickOutside.ts",
);

const stubModule = (filename, exports) => {
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

test("collapsed summary tooltip escapes the clipped teaser header", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousReact = global.React;
  const previousNavigator = global.navigator;
  const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  const previousScssLoader = require.extensions[".scss"];
  const previousContextModule = require.cache[contextPath];
  const previousClickOutsideModule = require.cache[clickOutsidePath];
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://app.hypertask.ai/detail/project-15/5706",
  });
  let expanded = false;
  let reactRoot;

  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.React = React;
    global.navigator = dom.window.navigator;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    require.extensions[".scss"] = () => {};
    stubModule(contextPath, {
      useTaskContext: () => ({
        isSummaryExpanded: expanded,
        setIsSummaryExpand: () => {},
      }),
    });
    stubModule(clickOutsidePath, { default: () => {} });

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
    const TaskSummary = jiti(
      path.join(
        root,
        "src/components/PageComponents/TaskDetail/TopRow/TaskSummary.tsx",
      ),
    ).default;
    const container = document.getElementById("root");
    reactRoot = require("react-dom/client").createRoot(container);
    const renderSummary = () =>
      React.createElement(TaskSummary, {
        taskSummary: "The first summary line",
      });

    await React.act(async () => reactRoot.render(renderSummary()));
    const header = container.querySelector(".header");
    const tooltipAnchor = header.querySelector("svg").parentElement;
    assert.match(header.className, /\boverflow-hidden\b/);

    await React.act(async () => {
      // jsdom does not derive native mouseenter from the bubbling mouseover.
      tooltipAnchor.dispatchEvent(
        new window.MouseEvent("mouseover", { bubbles: true }),
      );
      tooltipAnchor.dispatchEvent(new window.MouseEvent("mouseenter"));
    });
    const tooltip = [...document.body.children].find(
      (element) => element !== container,
    );
    assert.ok(tooltip);
    assert.match(tooltip.textContent, /Expand summary/);
    assert.equal(tooltip.parentElement, document.body);
    assert.equal(header.contains(tooltip), false);

    expanded = true;
    await React.act(async () => reactRoot.render(renderSummary()));
    assert.doesNotMatch(
      container.querySelector(".header").className,
      /\boverflow-hidden\b/,
    );
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom.window.close();
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousReact === undefined) delete global.React;
    else global.React = previousReact;
    if (previousNavigator === undefined) delete global.navigator;
    else global.navigator = previousNavigator;
    if (previousActEnvironment === undefined) delete global.IS_REACT_ACT_ENVIRONMENT;
    else global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    if (previousScssLoader === undefined) delete require.extensions[".scss"];
    else require.extensions[".scss"] = previousScssLoader;
    if (previousContextModule === undefined) delete require.cache[contextPath];
    else require.cache[contextPath] = previousContextModule;
    if (previousClickOutsideModule === undefined) delete require.cache[clickOutsidePath];
    else require.cache[clickOutsidePath] = previousClickOutsideModule;
  }
});
