const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");

const FLAG = "htpr-9387-header-arrows";
const playlist = [
  { projectId: 15, uniqueIndex: 1 },
  { projectId: 15, uniqueIndex: 2 },
];
let headerArrows = false;

const headerArrowsModule = (() => {
  try {
    return loadModule("src/lib/taskDetailHeaderArrows.ts");
  } catch {
    return { detailSidebarOverlays: () => false, ticketUpDownLivesInHeader: () => false };
  }
})();
const { detailSidebarOverlays, ticketUpDownLivesInHeader } = headerArrowsModule;

const TaskMovement = loadModule("src/components/PageComponents/TaskDetail/TaskMovement.tsx", {
  "@/components/Common/Tooltip": { default: () => null },
  "@/store": {
    tasksPlayListAtom: "playlist",
    showAIChatInterfaceAtom: "chat",
    isAiChatSidebarModeAtom: "sidebar",
  },
  "@/lib/state": {
    useRecoilState: (atom) => (atom === "playlist" ? [playlist, () => {}] : [false, () => {}]),
  },
  "@/hooks/useFlag": { useFlag: () => headerArrows },
  "@/lib/flags/definitions/htpr-9387-header-arrows": { HTPR_9387_HEADER_ARROWS_FLAG: FLAG },
}).default;

const mobile = React.createContext(false);
const marker = (name) => () => React.createElement("div", { "data-part": name }, name);
const task = { id: 42, projectId: 15, title: "Ticket", subTasks: [], description_: { content: "" } };

function loadTitle() {
  return loadModule(
    "src/components/PageComponents/TaskDetail/TopRow/TaskDetailTitleContainer.tsx",
    {
      "@/lib/contexts/TaskDetail/TaskProvider": {
        useTaskContext: () => ({ currentTask: task, parsedTask: JSON.stringify(task), cachedLayout: false }),
      },
      "@/lib/contexts/mobileContext": { MobileViewContext: mobile },
      "@/hooks/useFlag": { useFlag: (key) => key === FLAG && headerArrows },
      "@/lib/flags/definitions/htpr-9387-header-arrows": { HTPR_9387_HEADER_ARROWS_FLAG: FLAG },
      "@/lib/flags/definitions/htpr-8991-right-column": { HTPR_8991_RIGHT_COLUMN_FLAG: "htpr-8991-right-column" },
      "@/lib/flags/definitions/htpr-8997-id-row": { HTPR_8997_ID_ROW_FLAG: "htpr-8997-id-row" },
      "@/lib/flags/definitions/htpr-8992-sticky-title": { HTPR_8992_STICKY_TITLE_FLAG: "htpr-8992-sticky-title" },
      "@/lib/flags/definitions/htpr-9054-remove-agent-chip-under-title": {
        HTPR_9054_REMOVE_AGENT_CHIP_FLAG: "htpr-9054-remove-agent-chip-under-title",
      },
      "@/lib/flags/definitions/htpr-7339-agent-pulse-dot": {
        HTPR_7339_AGENT_PULSE_DOT_FLAG: "htpr-7339-agent-pulse-dot",
      },
      "@/lib/taskDetailHeaderArrows": { ticketUpDownLivesInHeader },
      "@/hooks/General/useCopyURL": { default: () => ({ copyTicketNumber: () => {} }) },
      "@/components/Common/Tooltip": { default: () => null },
      "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
      "../TaskOptions/TaskOptions": { default: marker("options") },
      "./TaskTitle": { default: marker("title") },
      "./TaskSummary": { default: marker("summary") },
      "@/components/Modals/Sheets/SummarySheet": { TaskSummaryMobile: marker("summary") },
      "./SubtaskLink": { default: marker("parent") },
      "./BaseTitleContainer": {
        default: ({ titleRowContent }) => React.createElement("div", { "data-title-row": "true" }, titleRowContent),
      },
      "./MobileTaskDueDate": { default: marker("due") },
      "@/lib/agentStatus/TaskDetailAgentStatusChip": { default: marker("chip") },
    },
  ).default;
}

const Title = loadTitle();

function arrows(placement) {
  return renderToStaticMarkup(React.createElement(TaskMovement, {
    placement,
    currentItemInTasksPlaylist: { projectId: 15, uniqueIndex: 2 },
    navigateToNextTask: () => {},
    navigateToPreviousTask: () => {},
  }));
}

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
  headerArrows = true;
  const html = arrows("header");
  assert.match(html, /data-task-nav="header"/);
  assert.equal(html.includes("task-nav-controls"), false);
  assert.equal(html.includes("rounded-[20px]"), false);
  assert.equal(html.includes("bg-back-button"), false);
  assert.equal(html.includes("shadow-md"), false);
  assert.match(html, /2 \/ 2/);

  headerArrows = false;
  const rolledBack = arrows("header");
  assert.match(rolledBack, /data-task-nav="rail"/);
  assert.match(rolledBack, /task-nav-controls/);
  assert.match(rolledBack, /rounded-\[20px\]/);
  assert.match(rolledBack, /bg-back-button/);
  assert.match(rolledBack, /shadow-md/);
  assert.equal(rolledBack.includes('data-task-nav="header"'), false);

  headerArrows = true;
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
  const render = (isMobile) => renderToStaticMarkup(React.createElement(
    mobile.Provider,
    { value: isMobile },
    React.createElement(Title, { toggleDueDate: () => {}, headerNavigation: arrowsNode }),
  ));
  headerArrows = true;
  const desktop = render(false);
  assert.match(desktop, /data-title-row="true"[\s\S]*data-part="arrows"/);
  assert.match(desktop, /data-part="options"/);
  headerArrows = false;
  assert.equal(render(false).includes('data-part="arrows"'), false);
  headerArrows = true;
  assert.equal(render(true).includes('data-part="arrows"'), false);
});
