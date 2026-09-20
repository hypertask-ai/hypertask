const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  jsx: { runtime: "automatic", importSource: "react" },
  alias: { "@": path.join(root, "src") },
});

const stubSourceModule = (relativePath, exports) => {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
};

const canonicalControlProps = [];
stubSourceModule("src/hooks/useFlag.tsx", {
  useFlag: (key) => key === "htpr-6422-my-tasks-views",
});
stubSourceModule("src/hooks/MultiPages/useClickOutside.ts", {
  default: () => {},
});
stubSourceModule("src/lib/configs/general.config.ts", {
  MOBILE_TARGET: "",
});
stubSourceModule(
  "src/components/PageComponents/Kanban/HeaderComponents/SaveViewHeaderKanban.tsx",
  {
    SaveViewActions: (props) => {
      canonicalControlProps.push(props);
      return React.createElement(
        "div",
        { "data-canonical-save-view-actions": "" },
        React.createElement("button", { onClick: props.onReset }, "Reset"),
        props.onSave
          ? React.createElement("button", { onClick: props.onSave }, "Save view")
          : null,
      );
    },
  },
);

global.React = React;
const MyTasksViewTabs = jiti(
  path.join(root, "src/app/my-tasks/MyTasksViewTabs.tsx"),
).default;

const renderTabs = (dom, overrides = {}) => {
  const onSave = overrides.onSave ?? (() => {});
  const onReset = overrides.onReset ?? (() => {});
  const reactRoot = createRoot(dom.window.document.getElementById("root"));
  act(() => {
    reactRoot.render(
      React.createElement(MyTasksViewTabs, {
        views: [{ id: 1, name: "Mine", isDefault: false, config: {} }],
        activeViewId: 1,
        dirty: true,
        busy: false,
        onSelect: () => {},
        onSave,
        onReset,
        onSaveAs: () => {},
        onRename: () => {},
        onDelete: () => {},
        onSetDefault: () => {},
        ...overrides,
      }),
    );
  });
  return reactRoot;
};

test("My Tasks delegates dirty-view actions to the canonical Kanban control", () => {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "https://app.hypertask.ai/my-tasks" },
  );
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  canonicalControlProps.length = 0;
  let saves = 0;
  let resets = 0;

  const reactRoot = renderTabs(dom, {
    onSave: () => { saves += 1; },
    onReset: () => { resets += 1; },
  });

  const actions = dom.window.document.querySelector(
    "[data-canonical-save-view-actions]",
  );
  assert.ok(actions, "the shared Kanban saved-view actions must render");
  assert.equal(canonicalControlProps.length, 1);
  assert.equal(canonicalControlProps[0].isDirty, true);
  assert.equal(canonicalControlProps[0].disabled, false);

  const [resetButton, saveButton] = actions.querySelectorAll("button");
  act(() => resetButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  act(() => saveButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(saves, 1);
  assert.equal(resets, 1);

  act(() => reactRoot.unmount());
  delete global.window;
  delete global.document;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});
