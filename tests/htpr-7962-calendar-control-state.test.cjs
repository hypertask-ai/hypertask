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

function controlState() {
  const html = renderToStaticMarkup(React.createElement(Calendar));
  const buttons = [...html.matchAll(/<button\b([^>]*)>/g)].map((match) => {
    const label = match[1].match(/aria-label="([^"]*)"/);
    const className = match[1].match(/\bclass="([^"]*)"/);
    return {
      label: label ? label[1] : "",
      className: className ? className[1] : "",
    };
  });
  const filter = buttons.find((button) => button.label === "Show filter options" || button.label.startsWith("Filter,"));
  const sort = buttons.find((button) => button.label === "Show sorting options" || button.label.startsWith("Sort,"));
  return {
    names: { filter: filter?.label, sort: sort?.label },
    classes: { filter: filter?.className, sort: sort?.className },
  };
}

test("calendar filter and sort names say on and off", () => {
  state.flag = false;
  state.taskFilters = emptyFilters();
  state.calendarSort = null;
  const idleOff = controlState();
  assert.deepEqual(idleOff.names, {
    filter: "Show filter options",
    sort: "Show sorting options",
  });

  state.flag = true;
  const idleOn = controlState();
  assert.deepEqual(idleOn.names, {
    filter: "Filter, off",
    sort: "Sort, off",
  });
  assert.deepEqual(idleOn.classes, idleOff.classes);

  state.flag = false;
  state.taskFilters = {
    ...emptyFilters(),
    priority: [1, 2],
    assignees: [9],
  };
  state.calendarSort = { mode: "DueDate", order: "Ascending" };
  const activeOff = controlState();

  state.flag = true;
  const activeOn = controlState();
  assert.deepEqual(activeOn.names, {
    filter: "Filter, 3 active",
    sort: "Sort, by due date",
  });
  assert.deepEqual(activeOn.classes, activeOff.classes);
});
