const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { JSDOM } = require("jsdom");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      interopDefault: true,
      moduleCache: false,
      jsx: true,
      alias: { "@": path.join(root, "src") },
    })
  : jitiModule(__filename, {
      interopDefault: true,
      cache: false,
      jsx: true,
      alias: { "@": path.join(root, "src") },
    });
const DueDateLabel = jiti(
  path.join(root, "src/components/Labels/DueDateLabel.tsx"),
).default;
const MobileTaskDueDate = jiti(
  path.join(
    root,
    "src/components/PageComponents/TaskDetail/TopRow/MobileTaskDueDate.tsx",
  ),
).default;

test("due-date labels are safe with and without a click action", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousNavigator = global.navigator;
  const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  const dom = new JSDOM(
    "<!doctype html><div id='parent'><div id='root'></div></div>",
  );
  const errors = [];
  let clickCount = 0;
  let parentClickCount = 0;
  let reactRoot;

  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    window.addEventListener("error", (event) => errors.push(event.error));

    const container = document.getElementById("root");
    document
      .getElementById("parent")
      .addEventListener("click", () => parentClickCount++);
    reactRoot = require("react-dom/client").createRoot(container);

    await React.act(async () => {
      reactRoot.render(
        React.createElement(DueDateLabel, {
          dueDate: new Date("2026-08-26T12:00:00.000Z"),
        }),
      );
    });
    await React.act(async () => container.querySelector("span").click());
    assert.deepEqual(errors, []);
    assert.equal(parentClickCount, 1);
    parentClickCount = 0;

    await React.act(async () => {
      reactRoot.render(
        React.createElement(DueDateLabel, {
          dueDate: new Date("2026-08-26T12:00:00.000Z"),
          onClick: () => clickCount++,
          stopPropogation: true,
        }),
      );
    });
    await React.act(async () => container.querySelector("span").click());
    assert.equal(clickCount, 1);
    assert.equal(parentClickCount, 0);
    assert.deepEqual(errors, []);
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom.window.close();
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousNavigator === undefined) delete global.navigator;
    else global.navigator = previousNavigator;
    if (previousActEnvironment === undefined) {
      delete global.IS_REACT_ACT_ENVIRONMENT;
    } else {
      global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
});

test("mobile task detail exposes its existing due date exactly once", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousNavigator = global.navigator;
  const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  const dom = new JSDOM("<!doctype html><div id='root'></div>");
  let clickCount = 0;
  let reactRoot;

  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    global.IS_REACT_ACT_ENVIRONMENT = true;

    const container = document.getElementById("root");
    reactRoot = require("react-dom/client").createRoot(container);
    const renderControl = async (props) => {
      await React.act(async () => {
        reactRoot.render(React.createElement(MobileTaskDueDate, props));
      });
    };

    await renderControl({
      dueDate: "2026-09-02T08:00:00.000Z",
      isMobile: true,
      onClick: () => clickCount++,
    });
    const button = container.querySelector('button[aria-label="Change due date"]');
    assert.ok(button);
    assert.match(button.textContent, /Sep 02/);
    assert.ok(button.classList.contains("min-h-[44px]"));
    assert.ok(button.classList.contains("min-w-[44px]"));

    await React.act(async () => button.click());
    assert.equal(clickCount, 1);

    await React.act(async () =>
      button.querySelector("svg").dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
    );
    assert.equal(clickCount, 2);

    await React.act(async () =>
      button.querySelector("span").dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
    );
    assert.equal(clickCount, 3);

    await renderControl({
      dueDate: "2026-09-02T08:00:00.000Z",
      isMobile: false,
      onClick: () => clickCount++,
    });
    assert.equal(container.querySelector("button"), null);

    await renderControl({
      dueDate: null,
      isMobile: true,
      onClick: () => clickCount++,
    });
    assert.equal(container.querySelector("button"), null);
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom.window.close();
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousNavigator === undefined) delete global.navigator;
    else global.navigator = previousNavigator;
    if (previousActEnvironment === undefined) {
      delete global.IS_REACT_ACT_ENVIRONMENT;
    } else {
      global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
});
