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
  path.join(
    root,
    "src/components/PageComponents/Calendar/CalendarHydrationBoundary.ts",
  ),
).default;

const runInstant = new Date("2026-09-27T22:50:30.556Z");

const CalendarDateMarkup = ({ instant }) => {
  const date = new Date(instant);
  const selectedDay = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  return React.createElement(
    "div",
    {
      "data-selected-day": selectedDay,
      "data-day-id": `day-${date.toISOString()}`,
    },
    selectedDay,
  );
};

const calendarMarkup = (timezone) => {
  process.env.TZ = timezone;
  return renderToString(
    React.createElement(CalendarDateMarkup, {
      instant: runInstant.toISOString(),
    }),
  );
};

test("date-dependent calendar markup differs across the reported timezones", () => {
  assert.notEqual(calendarMarkup("UTC"), calendarMarkup("Europe/Berlin"));
});

test("the calendar boundary renders the same hydration placeholder", () => {
  process.env.TZ = "UTC";
  const serverHtml = renderToString(
    React.createElement(
      CalendarHydrationBoundary,
      null,
      React.createElement(CalendarDateMarkup, {
        instant: runInstant.toISOString(),
      }),
    ),
  );
  process.env.TZ = "Europe/Berlin";
  const browserHtml = renderToString(
    React.createElement(
      CalendarHydrationBoundary,
      null,
      React.createElement(CalendarDateMarkup, {
        instant: runInstant.toISOString(),
      }),
    ),
  );

  assert.equal(serverHtml, "<div>Loading...</div>");
  assert.equal(browserHtml, serverHtml);
});

test("React hydrates the boundary before mounting browser-local dates", async () => {
  process.env.TZ = "UTC";
  const serverHtml = renderToString(
    React.createElement(
      CalendarHydrationBoundary,
      null,
      React.createElement(CalendarDateMarkup, {
        instant: runInstant.toISOString(),
      }),
    ),
  );

  process.env.TZ = "Europe/Berlin";
  const dom = new JSDOM(`<div id="root">${serverHtml}</div>`, {
    url: "https://app.hypertask.ai/calendar",
  });
  const previousGlobals = {
    window: global.window,
    document: global.document,
    navigator: global.navigator,
    actEnvironment: global.IS_REACT_ACT_ENVIRONMENT,
  };
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const recoverableErrors = [];
  const container = dom.window.document.getElementById("root");
  const rootNode = hydrateRoot(
    container,
    React.createElement(
      CalendarHydrationBoundary,
      null,
      React.createElement(CalendarDateMarkup, {
        instant: runInstant.toISOString(),
      }),
    ),
    { onRecoverableError: (error) => recoverableErrors.push(error) },
  );

  await act(async () => {});
  assert.deepEqual(recoverableErrors, []);
  assert.equal(
    container.firstElementChild.getAttribute("data-selected-day"),
    "2026-9-28",
  );
  assert.equal(
    container.firstElementChild.getAttribute("data-day-id"),
    "day-2026-09-27T22:50:30.556Z",
  );

  await act(async () => rootNode.unmount());
  dom.window.close();
  global.window = previousGlobals.window;
  global.document = previousGlobals.document;
  global.navigator = previousGlobals.navigator;
  global.IS_REACT_ACT_ENVIRONMENT = previousGlobals.actEnvironment;
});
