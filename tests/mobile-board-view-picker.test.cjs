const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const React = require("react");
const { act, useEffect } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");

const repositoryRoot = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(repositoryRoot, "src") },
  interopDefault: true,
  jsx: true,
  moduleCache: false,
});
const pickerModule = jiti(
  path.join(
    repositoryRoot,
    "src/components/Global/MobileBoardViewPicker.tsx",
  ),
);
const MobileBoardViewPicker =
  pickerModule.MobileBoardViewPicker ?? pickerModule.default;

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.hypertask.ai/project?id=15",
});
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.MouseEvent = dom.window.MouseEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.requestAnimationFrame = (callback) => {
  callback(0);
  return 1;
};
dom.window.cancelAnimationFrame = () => {};

const mountedRoots = [];

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const root = mountedRoots.pop();
    await act(async () => root.unmount());
  }
  document.body.replaceChildren();
});

const FakeSheet = ({ children, onClose, ariaLabel }) => {
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return React.createElement(
    "div",
    { role: "dialog", "aria-label": ariaLabel },
    children,
  );
};

const items = [
  { id: "default", label: "Hypertask Product", count: 43 },
  { id: "bugs", label: "Bugs", count: 7 },
  { id: "mine", label: "My Tasks", count: 12 },
];

const renderPicker = async (props = {}) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => {
    root.render(
      React.createElement(MobileBoardViewPicker, {
        items,
        activeViewId: "default",
        fallbackLabel: "Board",
        onSelect: () => {},
        SheetComponent: FakeSheet,
        ...props,
      }),
    );
  });
  return container;
};

const click = async (element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

test("the compact trigger opens every view with canonical labels and counts", async () => {
  const container = await renderPicker();
  const trigger = container.querySelector('button[aria-haspopup="dialog"]');

  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.match(trigger.textContent, /Hypertask Product/);
  assert.match(trigger.textContent, /43/);

  await click(trigger);

  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  const options = [...container.querySelectorAll("[aria-label='Board views'] button")];
  assert.deepEqual(
    options.map((option) => option.textContent.trim().replace(/\s+/g, " ")),
    ["Hypertask Product43", "Bugs7", "My Tasks12"],
  );
  assert.equal(options[0].getAttribute("aria-current"), "true");
  assert.equal(document.activeElement, options[0]);
});

test("selection waits for a successful switch, closes, and restores trigger focus", async () => {
  let selectedId;
  let finishSwitch;
  const switchFinished = new Promise((resolve) => {
    finishSwitch = resolve;
  });
  const container = await renderPicker({
    onSelect: async (viewId) => {
      selectedId = viewId;
      await switchFinished;
    },
  });
  const trigger = container.querySelector('button[aria-haspopup="dialog"]');
  await click(trigger);
  const bugs = [...container.querySelectorAll("[aria-label='Board views'] button")]
    .find((option) => option.textContent.includes("Bugs"));

  await click(bugs);
  assert.equal(selectedId, "bugs");
  assert.ok(container.querySelector('[role="dialog"]'));
  assert.equal(bugs.getAttribute("aria-busy"), "true");

  await act(async () => {
    finishSwitch();
    await switchFinished;
  });

  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, trigger);
});

test("a dismissed request cannot close or overwrite a newer picker session", async () => {
  const requests = [];
  const container = await renderPicker({
    onSelect: (viewId) =>
      new Promise((resolve) => requests.push({ viewId, resolve })),
  });
  const trigger = container.querySelector('button[aria-haspopup="dialog"]');

  await click(trigger);
  let options = [...container.querySelectorAll("[aria-label='Board views'] button")];
  await click(options[1]);
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });

  await click(trigger);
  options = [...container.querySelectorAll("[aria-label='Board views'] button")];
  await click(options[2]);
  assert.deepEqual(requests.map((request) => request.viewId), ["bugs", "mine"]);

  await act(async () => requests[0].resolve());
  assert.ok(container.querySelector('[role="dialog"]'));
  assert.equal(options[2].getAttribute("aria-busy"), "true");

  await act(async () => requests[1].resolve());
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, trigger);
});

test("a failed switch keeps the picker open with a retry message", async () => {
  const container = await renderPicker({
    onSelect: async () => {
      throw new Error("request failed");
    },
  });
  await click(container.querySelector('button[aria-haspopup="dialog"]'));
  const bugs = [...container.querySelectorAll("[aria-label='Board views'] button")]
    .find((option) => option.textContent.includes("Bugs"));

  await click(bugs);

  assert.ok(container.querySelector('[role="dialog"]'));
  assert.equal(
    container.querySelector('[role="status"]').textContent.trim(),
    "Couldn’t switch views. Try again.",
  );
  assert.equal(bugs.disabled, false);
});

test("Escape dismisses the picker and a missing active view has a safe fallback", async () => {
  const container = await renderPicker({ activeViewId: "deleted" });
  const trigger = container.querySelector('button[aria-haspopup="dialog"]');
  assert.match(trigger.textContent, /Hypertask Product/);

  await click(trigger);
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });

  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, trigger);
});

test("an empty view list renders a stable board label instead of a dead picker", async () => {
  const container = await renderPicker({ items: [], fallbackLabel: "Fallback Board" });

  assert.equal(container.querySelector("button"), null);
  assert.equal(container.textContent.trim(), "Fallback Board");
});

test("the board header reuses rendered-view labels, order, and counts", () => {
  const header = fs.readFileSync(
    path.join(repositoryRoot, "src/components/Global/MobileHeaderStrip.tsx"),
    "utf8",
  );

  assert.match(header, /<MobileBoardViewPicker/);
  assert.match(header, /items=\{renderedViews\.map/);
  assert.match(header, /view\.id === defaultViewId[\s\S]*project\.title \|\| project\.name/);
  assert.match(header, /count: viewTaskCounts\.get\(view\.id\) \?\? 0/);
  assert.doesNotMatch(header, /<Strip\s+items=\{renderedViews\.map/);
});
