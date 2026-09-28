const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { startOfWeek, addDays } = require("date-fns");
const { JSDOM } = require("jsdom");
const React = require("react");
const { act } = React;
const { hydrateRoot } = require("react-dom/client");
const { renderToString } = require("react-dom/server");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { interopDefault: true });
const {
  calendarDateFromKey,
  calendarDateKeyFromInstant,
  initialCalendarDates,
} = jiti(path.join(root, "src/lib/calendarInitialDate.ts"));
const { getCalendarTitle } = jiti(
  path.join(
    root,
    "src/components/PageComponents/Calendar/calendarTitle.ts",
  ),
);

const runInstant = new Date("2026-09-27T22:50:30.556Z");

const calendarSnapshot = (date) => {
  const weekStart = startOfWeek(date, { weekStartsOn: 0 });

  return {
    desktopTitle: getCalendarTitle({
      currentView: "week",
      currentDate: date,
      today: date,
      weekStartsOn: 0,
    }),
    selectedDay: `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
    mobileDays: Array.from({ length: 7 }, (_, index) => {
      const day = addDays(weekStart, index);
      return `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
    }),
  };
};

const initialSnapshot = (timezone, dateKey) => {
  process.env.TZ = timezone;
  return calendarSnapshot(calendarDateFromKey(dateKey));
};

const CalendarInitialMarkup = ({ dateKey }) => {
  const [dates] = React.useState(() => initialCalendarDates(dateKey));
  const snapshot = calendarSnapshot(dates.currentDate);
  return React.createElement(
    "div",
    {
      "data-selected-day": snapshot.selectedDay,
      "data-today": `${dates.today.getFullYear()}-${dates.today.getMonth() + 1}-${dates.today.getDate()}`,
    },
    `${snapshot.desktopTitle}|${snapshot.mobileDays.join(",")}`,
  );
};

test("the old instant-based initializer renders different calendar markup", () => {
  process.env.TZ = "UTC";
  const serverSnapshot = calendarSnapshot(new Date(runInstant));
  process.env.TZ = "Europe/Berlin";
  const browserSnapshot = calendarSnapshot(new Date(runInstant));

  assert.notDeepEqual(serverSnapshot, browserSnapshot);
});

test("calendar initial markup keeps one logical date across server and browser timezones", () => {
  const initialDateKey = calendarDateKeyFromInstant(runInstant);

  assert.deepEqual(
    initialSnapshot("UTC", initialDateKey),
    initialSnapshot("Europe/Berlin", initialDateKey),
  );
});

test("React hydrates calendar date state without a recoverable error", async () => {
  const initialDateKey = calendarDateKeyFromInstant(runInstant);
  process.env.TZ = "UTC";
  const serverHtml = renderToString(
    React.createElement(CalendarInitialMarkup, { dateKey: initialDateKey }),
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
    React.createElement(CalendarInitialMarkup, { dateKey: initialDateKey }),
    { onRecoverableError: (error) => recoverableErrors.push(error) },
  );

  await act(async () => {});
  assert.deepEqual(recoverableErrors, []);
  assert.equal(
    container.firstElementChild.getAttribute("data-selected-day"),
    "2026-9-27",
  );

  await act(async () => rootNode.unmount());
  dom.window.close();
  global.window = previousGlobals.window;
  global.document = previousGlobals.document;
  global.navigator = previousGlobals.navigator;
  global.IS_REACT_ACT_ENVIRONMENT = previousGlobals.actEnvironment;
});

test("the reported run crossed into the next browser-local day", () => {
  const initialDateKey = calendarDateKeyFromInstant(runInstant);

  process.env.TZ = "Europe/Berlin";
  assert.equal(initialDateKey, "2026-09-27");
  assert.equal(runInstant.getDate(), 28);
});
