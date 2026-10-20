const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const React = require("react");
const { act } = React;
const { hydrateRoot } = require("react-dom/client");
const { renderToString } = require("react-dom/server");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { interopDefault: true });
const CalendarHydrationBoundary = jiti(
  path.join(root, "src/components/PageComponents/Calendar/CalendarHydrationBoundary.ts"),
).default;
const fallback = React.createElement(
  "div",
  { "aria-busy": "true", "data-calendar-loading-shell": "" },
  "Loading calendar…",
);

const CalendarDateMarkup = () => {
  const date = new Date("2026-09-27T22:50:30.556Z");
  return React.createElement(
    "div",
    { "data-calendar-child": "" },
    `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
  );
};

const boundary = (props) => React.createElement(
  CalendarHydrationBoundary,
  props,
  React.createElement(CalendarDateMarkup),
);

test("server rendering shows the custom fallback instead of children or bare Loading...", () => {
  const html = renderToString(boundary({ fallback }));
  assert.match(html, /data-calendar-loading-shell=""/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Loading calendar…/);
  assert.doesNotMatch(html, /data-calendar-child|Loading\.\.\./);
});

test("the date-free fallback hydrates across timezones before mounting local calendar dates", async () => {
  const previousTZ = process.env.TZ;
  const previousGlobals = Object.fromEntries(
    ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"].map(
      (key) => [key, Object.getOwnPropertyDescriptor(global, key)],
    ),
  );
  let dom;
  let rootNode;
  try {
    process.env.TZ = "UTC";
    const serverDates = renderToString(React.createElement(CalendarDateMarkup));
    const serverHtml = renderToString(boundary({ fallback }));
    process.env.TZ = "Europe/Berlin";
    assert.notEqual(renderToString(React.createElement(CalendarDateMarkup)), serverDates);
    assert.equal(renderToString(boundary({ fallback })), serverHtml);
    dom = new JSDOM(`<div id="root">${serverHtml}</div>`, {
      url: "https://app.hypertask.ai/calendar",
    });
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      Object.defineProperty(global, key, { configurable: true, writable: true, value });
    }
    const recoverableErrors = [];
    const container = dom.window.document.getElementById("root");
    await act(async () => {
      rootNode = hydrateRoot(container, boundary({ fallback }), {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
    });
    assert.deepEqual(recoverableErrors, []);
    assert.equal(container.querySelector("[data-calendar-child]").textContent, "2026-9-28");
    assert.equal(container.querySelector("[data-calendar-loading-shell]"), null);
  } finally {
    if (rootNode) await act(async () => rootNode.unmount());
    dom?.window.close();
    for (const [key, descriptor] of Object.entries(previousGlobals)) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test("without a fallback the original loading div is unchanged", () => {
  assert.equal(renderToString(boundary()), "<div>Loading...</div>");
});

test("the calendar loading shell flag declares its bugfix key and release risk", () => {
  const definition = jiti(
    path.join(root, "src/lib/flags/definitions/htpr-7397-calendar-loading-shell.ts"),
  );
  assert.equal(definition.HTPR_7397_CALENDAR_LOADING_SHELL_FLAG, "htpr-7397-calendar-loading-shell");
  assert.equal(definition.default.key, definition.HTPR_7397_CALENDAR_LOADING_SHELL_FLAG);
  assert.equal(definition.default.kind, "bugfix");
  assert.equal(definition.default.shippedOn, "2026-10-20");
  assert.equal(definition.default.releaseRisk.risk, "small");
});
