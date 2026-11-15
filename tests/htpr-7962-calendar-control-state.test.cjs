const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const state = {
  flag: false,
  taskFilters: emptyFilters(),
  calendarSort: null,
};

function emptyFilters() {
  return {
    assignedToMe: false,
    updatedBy: [],
    createdBy: [],
    priority: [],
    assignees: [],
    assigneeAgents: [],
    updatedByAgents: [],
    labels: [],
    size: [],
    matchFilters: "ANY",
  };
}

const { Calendar } = loadModule(
  "src/components/PageComponents/Calendar/calendar.tsx",
  {
    "@/hooks/useFlag": { useFlag: () => state.flag },
    "@/lib/contexts/Calendar/calendar.context": {
      useCalendarContext: () => ({
        currentView: "month",
        onDragEnd: () => {},
        handlePrevious: () => {},
        handleNext: () => {},
        setCurrentView: () => {},
        handleDateSelect: () => {},
        currentDate: new Date(2026, 6, 15),
        toggleFilterModal: () => {},
        get taskFilters() {
          return state.taskFilters;
        },
        get calendarSort() {
          return state.calendarSort;
        },
        setCalendarSort: () => {},
        isCalendarViewDirty: false,
        resetCalendarView: () => {},
      }),
    },
    "@/lib/state": {
      useRecoilValue: (atom) =>
        atom === "settings" ? { weekStartsOn: "monday" } : false,
      useSetRecoilState: () => () => {},
    },
    "@/store": {
      appShellRailAtom: "rail",
      calendarBoardsSidebarOpenAtom: "boards",
      calendarSettingsAtom: "settings",
    },
    "@/styles/search.module.scss": { links_modal: "links" },
    "@/components/Common/Tooltip": { default: () => null },
    "@/components/Common/kbd": { default: () => null },
    "@/components/Modals/Kanban/BoardPriorityMode": { default: () => null },
    "@/components/Modals/Calendar/views.modal": { default: () => null },
    "@/utils/helperFunctions/helperFunctions": {
      returnIfModalOrInputActive: () => false,
    },
    "@/components/PageComponents/Kanban/HeaderComponents/GuestAuthLinks": {
      default: () => null,
    },
    "./month-view": { MonthView: () => null },
    "./week-view": { WeekView: () => null },
    "./CalendarSplitsRow": { default: () => null },
    "@hello-pangea/dnd": {
      DragDropContext: ({ children }) => children,
    },
    "@/models/Views/model": {
      sortingModeLabel: (mode) => (mode === "DueDate" ? "Due Date" : mode),
    },
  },
);

function controlNames() {
  const html = renderToStaticMarkup(React.createElement(Calendar));
  const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1]);
  return {
    filter: labels.find((label) => label === "Show filter options" || label.startsWith("Filter,")),
    sort: labels.find((label) => label === "Show sorting options" || label.startsWith("Sort,")),
  };
}

test("calendar filter and sort names say on and off", () => {
  state.flag = false;
  state.taskFilters = emptyFilters();
  state.calendarSort = null;
  assert.deepEqual(controlNames(), {
    filter: "Show filter options",
    sort: "Show sorting options",
  });

  state.flag = true;
  assert.deepEqual(controlNames(), {
    filter: "Filter, off",
    sort: "Sort, off",
  });

  state.taskFilters = {
    ...emptyFilters(),
    priority: [1, 2],
    assignees: [9],
  };
  state.calendarSort = { mode: "DueDate", order: "Ascending" };
  assert.deepEqual(controlNames(), {
    filter: "Filter, 3 active",
    sort: "Sort, by due date",
  });
});
