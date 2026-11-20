const React = require("react");
const { loadModule } = require("../helpers/loadModule.cjs");

const FLAG = "htpr-9387-header-arrows";
const playlist = [{ projectId: 15, uniqueIndex: 1 }, { projectId: 15, uniqueIndex: 2 }];
const mobile = React.createContext(false);
const marker = (name) => () => React.createElement("div", { "data-part": name }, name);
const task = { id: 42, projectId: 15, title: "Ticket", subTasks: [], description_: { content: "" } };
let headerArrows = false;

const setHeaderArrows = (value) => {
  headerArrows = value;
};

const headerArrowsModule = (() => {
  try {
    return loadModule("src/lib/taskDetailHeaderArrows.ts");
  } catch {
    return { detailSidebarOverlays: () => false, ticketUpDownLivesInHeader: () => false };
  }
})();

const TaskMovement = loadModule("src/components/PageComponents/TaskDetail/TaskMovement.tsx", {
  "@/components/Common/Tooltip": { default: () => null },
  "@/store": { tasksPlayListAtom: "playlist", showAIChatInterfaceAtom: "chat", isAiChatSidebarModeAtom: "sidebar" },
  "@/lib/state": { useRecoilState: (atom) => (atom === "playlist" ? [playlist, () => {}] : [false, () => {}]) },
  "@/hooks/useFlag": { useFlag: () => headerArrows },
  "@/lib/flags/definitions/htpr-9387-header-arrows": { HTPR_9387_HEADER_ARROWS_FLAG: FLAG },
}).default;

const Title = loadModule("src/components/PageComponents/TaskDetail/TopRow/TaskDetailTitleContainer.tsx", {
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
  "@/lib/flags/definitions/htpr-7339-agent-pulse-dot": { HTPR_7339_AGENT_PULSE_DOT_FLAG: "htpr-7339-agent-pulse-dot" },
  "@/lib/taskDetailHeaderArrows": { ticketUpDownLivesInHeader: headerArrowsModule.ticketUpDownLivesInHeader },
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
}).default;

module.exports = {
  FLAG,
  playlist,
  mobile,
  setHeaderArrows,
  TaskMovement,
  Title,
  detailSidebarOverlays: headerArrowsModule.detailSidebarOverlays,
  ticketUpDownLivesInHeader: headerArrowsModule.ticketUpDownLivesInHeader,
};
