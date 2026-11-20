const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const stubs = require("./fixtures/htpr-9387-header-arrows-stubs.cjs");
const { detailSidebarOverlays, ticketUpDownLivesInHeader, setHeaderArrows, TaskMovement, Title, mobile } = stubs;

const arrows = (placement) => renderToStaticMarkup(React.createElement(TaskMovement, {
  placement,
  currentItemInTasksPlaylist: { projectId: 15, uniqueIndex: 2 },
  navigateToNextTask: () => {},
  navigateToPreviousTask: () => {},
}));

test("up and down live in the desktop header only when the ticket flag is on", () => {
  assert.equal(ticketUpDownLivesInHeader(true, false, false), true);
  assert.equal(ticketUpDownLivesInHeader(false, false, false), false);
  assert.equal(ticketUpDownLivesInHeader(true, true, false), false);
  assert.equal(ticketUpDownLivesInHeader(true, false, true), false);
  assert.equal(ticketUpDownLivesInHeader(true, false, false, true), false);
  assert.equal(detailSidebarOverlays(1920, 420, false), false);
  assert.equal(detailSidebarOverlays(1440, 420, false), false);
  assert.equal(detailSidebarOverlays(1280, 420, false), true);
  assert.equal(detailSidebarOverlays(1440, 340, false), false);
  assert.equal(detailSidebarOverlays(1280, 340, false), true);
  assert.equal(detailSidebarOverlays(1440, 0, false), false);
  assert.equal(detailSidebarOverlays(1000, 420, true), false);
});

test("header arrows are plain chevrons and still move between tickets", async () => {
  setHeaderArrows(true);
  const html = arrows("header");
  assert.match(html, /data-task-nav="header"/);
  assert.match(html, /2 \/ 2/);
  for (const gone of ["task-nav-controls", "rounded-[20px]", "bg-back-button", "shadow-md"]) assert.equal(html.includes(gone), false);
  setHeaderArrows(false);
  const rolledBack = arrows("header");
  assert.match(rolledBack, /data-task-nav="rail"/);
  for (const pill of ["task-nav-controls", "rounded-\\[20px\\]", "bg-back-button", "shadow-md"]) assert.match(rolledBack, new RegExp(pill));
  assert.equal(rolledBack.includes('data-task-nav="header"'), false);
  setHeaderArrows(true);
  const previousCalls = [];
  const nextCalls = [];
  const dom = new JSDOM("<div id='root'></div>");
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  await React.act(async () => {
    root.render(React.createElement(TaskMovement, {
      placement: "header",
      currentItemInTasksPlaylist: { projectId: 15, uniqueIndex: 2 },
      navigateToPreviousTask: (...args) => previousCalls.push(args),
      navigateToNextTask: (...args) => nextCalls.push(args),
    }));
  });
  dom.window.document.querySelector("[data-task-nav-direction=previous]").click();
  dom.window.document.querySelector("[data-task-nav-direction=next]").click();
  assert.deepEqual(previousCalls, [[false, false]]);
  assert.deepEqual(nextCalls, [[false, true]]);
  await React.act(async () => root.unmount());
  dom.window.close();
  global.window = previousWindow;
  global.document = previousDocument;
});

test("the header row holds the arrows on desktop and leaves the phone header alone", () => {
  const arrowsNode = React.createElement("div", { "data-part": "arrows" }, "arrows");
  const render = (isMobile) => renderToStaticMarkup(React.createElement(mobile.Provider, { value: isMobile },
    React.createElement(Title, { toggleDueDate: () => {}, headerNavigation: arrowsNode })));
  setHeaderArrows(true);
  const desktop = render(false);
  assert.match(desktop, /data-title-row="true"[\s\S]*data-part="arrows"/);
  assert.match(desktop, /data-part="options"/);
  setHeaderArrows(false);
  assert.equal(render(false).includes('data-part="arrows"'), false);
  setHeaderArrows(true);
  assert.equal(render(true).includes('data-part="arrows"'), false);
});
