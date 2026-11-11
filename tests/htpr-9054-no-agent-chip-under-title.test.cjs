const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadModule } = require("./helpers/loadModule.cjs");

const REMOVE_CHIP_FLAG = "htpr-9054-remove-agent-chip-under-title";
const AGENT_PULSE_DOT_FLAG = "htpr-7339-agent-pulse-dot";

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

const loadWithRemoveChipFlag = (removeChip) => {
  const container = loadModule(
    "src/components/PageComponents/TaskDetail/TopRow/TaskDetailTitleContainer.tsx",
    {
      "@/lib/contexts/TaskDetail/TaskProvider": {
        useTaskContext: () => ({ currentTask: task, parsedTask: JSON.stringify(task), cachedLayout: true }),
      },
      "@/lib/contexts/mobileContext": { MobileViewContext: mobile },
      "@/hooks/useFlag": { useFlag: (key) => (key === REMOVE_CHIP_FLAG ? removeChip : true) },
      "@/lib/flags/definitions/htpr-8991-right-column": { HTPR_8991_RIGHT_COLUMN_FLAG: "htpr-8991-right-column" },
      "@/lib/flags/definitions/htpr-8997-id-row": { HTPR_8997_ID_ROW_FLAG: "htpr-8997-id-row" },
      "@/lib/flags/definitions/htpr-8992-sticky-title": { HTPR_8992_STICKY_TITLE_FLAG: "htpr-8992-sticky-title" },
      "@/lib/flags/definitions/htpr-9054-remove-agent-chip-under-title": {
        HTPR_9054_REMOVE_AGENT_CHIP_FLAG: REMOVE_CHIP_FLAG,
      },
      "@/lib/flags/definitions/htpr-7339-agent-pulse-dot": {
        HTPR_7339_AGENT_PULSE_DOT_FLAG: AGENT_PULSE_DOT_FLAG,
      },
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
      "@/lib/agentStatus/TaskDetailAgentStatusChip": { default: marker("header-agent-chip") },
    },
  ).default;
  return container;
};

const render = (container, isMobile) =>
  renderToStaticMarkup(
    React.createElement(
      mobile.Provider,
      { value: isMobile },
      React.createElement(container, { toggleDueDate: noop }),
    ),
  );

test("with the ticket flag on, the header shows no agent status chip on desktop or phone even when a runner is working", () => {
  const container = loadWithRemoveChipFlag(true);
  for (const isMobile of [false, true]) {
    const html = render(container, isMobile);
    assert.match(html, /data-part="title"/, "the header still renders the title");
    assert.doesNotMatch(html, /data-part="header-agent-chip"/);
  }
});

test("with the ticket flag off, the header keeps today's agent status chip as the rollback path", () => {
  const container = loadWithRemoveChipFlag(false);
  for (const isMobile of [false, true]) {
    const html = render(container, isMobile);
    assert.match(html, /data-part="header-agent-chip"/);
  }
});
