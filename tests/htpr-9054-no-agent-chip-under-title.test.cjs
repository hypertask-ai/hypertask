const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadModule } = require("./helpers/loadModule.cjs");

const mobile = React.createContext(false);
const noop = () => {};
const marker = (name) => () => React.createElement("div", { "data-part": name }, name);
const task = {
  id: 42,
  projectId: 15,
  ticketNumber: "HTPR-9054",
  sectionId: 2,
  agentStatus: { agentName: "RUNNER 9", at: new Date().toISOString() },
  project: { section: [{ id: 2, section_title: "In Progress" }] },
  subTasks: [],
  description_: { content: "Body" },
};

const TitleContainer = loadModule(
  "src/components/PageComponents/TaskDetail/TopRow/TaskDetailTitleContainer.tsx",
  {
    "@/lib/contexts/TaskDetail/TaskProvider": {
      useTaskContext: () => ({ currentTask: task, parsedTask: JSON.stringify(task), cachedLayout: true }),
    },
    "@/lib/contexts/mobileContext": { MobileViewContext: mobile },
    "@/hooks/useFlag": { useFlag: () => true },
    "@/lib/flags/definitions/htpr-8991-right-column": { HTPR_8991_RIGHT_COLUMN_FLAG: "htpr-8991-right-column" },
    "@/lib/flags/definitions/htpr-8997-id-row": { HTPR_8997_ID_ROW_FLAG: "htpr-8997-id-row" },
    "@/lib/flags/definitions/htpr-8992-sticky-title": { HTPR_8992_STICKY_TITLE_FLAG: "htpr-8992-sticky-title" },
    "@/hooks/General/useCopyURL": { default: () => ({ copyTicketNumber: noop }) },
    "@/components/Common/Tooltip": { default: () => null },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "../TaskOptions/TaskOptions": { default: marker("options") },
    "./TaskTitle": { default: marker("title") },
    "./TaskSummary": { default: marker("summary") },
    "@/components/Modals/Sheets/SummarySheet": { TaskSummaryMobile: marker("summary") },
    "./SubtaskLink": { default: marker("parent") },
    "./BaseTitleContainer": {
      default: ({ titleRowContent, children }) =>
        React.createElement("header", null, titleRowContent, children),
    },
    "./MobileTaskDueDate": { default: marker("due") },
  },
).default;

const render = (isMobile) =>
  renderToStaticMarkup(
    React.createElement(
      mobile.Provider,
      { value: isMobile },
      React.createElement(TitleContainer, { toggleDueDate: noop }),
    ),
  );

test("the ticket header shows no agent status chip on desktop or phone, even when the ticket carries a running agent", () => {
  for (const isMobile of [false, true]) {
    const html = render(isMobile);
    assert.match(html, /data-part="title"/, "the header still renders the title");
    assert.doesNotMatch(html, /agent-status-chip/);
    assert.doesNotMatch(html, /RUNNER 9: /);
  }
});
