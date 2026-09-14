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
  jsx: { runtime: "automatic", importSource: "react" },
  alias: { "@": path.join(root, "src") },
});

const stubModule = (filename, exports) => {
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
};

stubModule(path.join(root, "src/lib/state.tsx"), {
  useRecoilValue: () => ({ weekStartsOn: "monday" }),
});
stubModule(path.join(root, "src/store/index.ts"), {
  calendarSettingsAtom: {},
});

global.React = React;

const { Calendar } = jiti(
  path.join(root, "src/components/Common/Calendar/index.tsx"),
);

const selectedDay = new Date(2026, 8, 15);
const nextDay = new Date(2026, 8, 16);
const rangeEnd = new Date(2026, 8, 18);

const installDom = () => {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "https://app.hypertask.ai/" },
  );
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  if (!global.window.ResizeObserver) {
    global.window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  return dom;
};

const cleanupDom = (reactRoot) => {
  act(() => {
    reactRoot.unmount();
  });
};

const click = (element, dom) => {
  assert.ok(element, "expected a clickable calendar control");
  act(() => {
    element.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
  });
};

const dayButton = (dom, date) =>
  [...dom.window.document.querySelectorAll("button")].find((button) => {
    const name = button.getAttribute("aria-label") || "";
    return (
      name.includes(String(date.getDate())) &&
      name.includes("September") &&
      name.includes("2026") &&
      !name.includes("Previous") &&
      !name.includes("Next")
    );
  });

const captionText = (dom) =>
  (
    dom.window.document.querySelector("[role='status']") ||
    [...dom.window.document.querySelectorAll("span, div")].find((node) =>
      /September|October|June|July/.test(node.textContent || ""),
    )
  )?.textContent || "";

test("single mode selects a day and reports that date", () => {
  const dom = installDom();
  const picks = [];
  const reactRoot = createRoot(dom.window.document.getElementById("root"));

  act(() => {
    reactRoot.render(
      React.createElement(Calendar, {
        mode: "single",
        selected: selectedDay,
        onSelect: (date) => picks.push(date),
        defaultMonth: selectedDay,
      }),
    );
  });

  const selected = dayButton(dom, selectedDay);
  assert.ok(selected, "selected September 15 must render");
  assert.match(selected.getAttribute("aria-label") || "", /selected/i);
  assert.equal(selected.parentElement?.getAttribute("aria-selected"), "true");
  assert.match(selected.parentElement?.className || "", /rdp-selected|bg-shadcn-primary/);

  click(dayButton(dom, nextDay), dom);
  assert.equal(picks.length, 1);
  assert.ok(picks[0] instanceof Date);
  assert.equal(picks[0].getFullYear(), 2026);
  assert.equal(picks[0].getMonth(), 8);
  assert.equal(picks[0].getDate(), 16);

  cleanupDom(reactRoot);
});

test("range mode reports from and to", () => {
  const dom = installDom();
  const picks = [];
  const reactRoot = createRoot(dom.window.document.getElementById("root"));

  act(() => {
    reactRoot.render(
      React.createElement(Calendar, {
        mode: "range",
        selected: { from: selectedDay },
        onSelect: (range) => picks.push(range),
        defaultMonth: selectedDay,
      }),
    );
  });

  const startCell = dayButton(dom, selectedDay)?.parentElement;
  assert.match(startCell?.className || "", /day-range-start/);

  click(dayButton(dom, rangeEnd), dom);
  assert.equal(picks.length, 1);
  assert.ok(picks[0]);
  assert.ok(picks[0].from instanceof Date);
  assert.ok(picks[0].to instanceof Date);
  assert.equal(picks[0].from.getDate(), 15);
  assert.equal(picks[0].to.getDate(), 18);

  cleanupDom(reactRoot);
});

test("month navigation and a controlled month both change the visible grid", () => {
  const dom = installDom();
  const reactRoot = createRoot(dom.window.document.getElementById("root"));

  act(() => {
    reactRoot.render(
      React.createElement(Calendar, {
        mode: "single",
        selected: selectedDay,
        onSelect: () => {},
        defaultMonth: selectedDay,
      }),
    );
  });

  assert.match(captionText(dom), /September/);
  const nextMonth = [...dom.window.document.querySelectorAll("button")].find(
    (button) => /next month/i.test(button.getAttribute("aria-label") || ""),
  );
  click(nextMonth, dom);
  assert.match(captionText(dom), /October/);

  act(() => {
    reactRoot.render(
      React.createElement(Calendar, {
        mode: "single",
        month: new Date(2026, 5, 1),
        onMonthChange: () => {},
        selected: new Date(2026, 5, 10),
        onSelect: () => {},
      }),
    );
  });
  assert.match(captionText(dom), /June/);

  act(() => {
    reactRoot.render(
      React.createElement(Calendar, {
        mode: "single",
        month: new Date(2026, 6, 1),
        onMonthChange: () => {},
        selected: new Date(2026, 6, 10),
        onSelect: () => {},
      }),
    );
  });
  assert.match(captionText(dom), /July/);

  cleanupDom(reactRoot);
});

test("autoFocus moves focus into the date grid", () => {
  const dom = installDom();
  const reactRoot = createRoot(dom.window.document.getElementById("root"));

  act(() => {
    reactRoot.render(
      React.createElement(Calendar, {
        mode: "single",
        autoFocus: true,
        selected: selectedDay,
        onSelect: () => {},
        defaultMonth: selectedDay,
      }),
    );
  });

  const active = dom.window.document.activeElement;
  assert.ok(active);
  assert.equal(active.tagName, "BUTTON");
  assert.match(
    active.getAttribute("aria-label") || active.textContent || "",
    /15|September|Previous|Next/,
  );

  cleanupDom(reactRoot);
});
