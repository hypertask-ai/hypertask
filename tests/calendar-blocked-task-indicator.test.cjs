const assert = require("node:assert/strict");
const path = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.resolve(__dirname, "..");
const modulePath = (relativePath) => path.join(root, relativePath);
const stubs = new Map();

const stubModule = (relativePath, exports) => {
  const filename = modulePath(relativePath);
  stubs.set(filename, require.cache[filename]);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

const restoreStubs = () => {
  for (const [filename, previous] of stubs) {
    if (previous === undefined) delete require.cache[filename];
    else require.cache[filename] = previous;
  }
};

const task = (waitingOnUserId) => ({
  id: waitingOnUserId == null ? 1 : 2,
  uniqueIndex: waitingOnUserId == null ? 1 : 2,
  ticketNumber: waitingOnUserId == null ? "HTPR-1" : "HTPR-2",
  title: waitingOnUserId == null ? "Ready task" : "Blocked task",
  projectId: 15,
  dueDate: new Date("2026-08-31T12:00:00.000Z"),
  waitingOnUserId,
  assignees: [],
  taskLabels: [],
  _count: { comments: 0, savedContent: 0 },
});

test("calendar cards show the board blocked indicator in month, week, and day views", () => {
  const dndPath = require.resolve("@hello-pangea/dnd");
  const previousDnd = require.cache[dndPath];
  const previousReact = global.React;

  try {
    global.React = React;
    require.cache[dndPath] = {
      id: dndPath,
      filename: dndPath,
      loaded: true,
      exports: {
        Draggable: ({ children }) =>
          children(
            {
              innerRef: () => {},
              draggableProps: { style: {} },
              dragHandleProps: {},
            },
            { isDragging: false, isDropAnimating: false },
          ),
      },
    };
    stubModule("src/lib/state.tsx", { useRecoilValue: () => ({ id: 15 }) });
    stubModule("src/store/index.ts", { currentProjectAtom: {} });
    stubModule("src/components/Common/Tooltip.tsx", { default: () => null });
    stubModule("src/components/Common/UserAvatar.tsx", { default: () => null });
    stubModule(
      "src/components/Modals/TaskPriority/PriorityLabelComponent.tsx",
      { default: () => null },
    );
    stubModule(
      "src/components/Modals/TaskEstimate/EstimateLabelComponent.tsx",
      { default: () => null },
    );
    stubModule(
      "src/components/Modals/CreateLabel/TaskLabelComponent.tsx",
      { default: () => null },
    );
    stubModule("src/components/PageComponents/Kanban/TableView/TableView.tsx", {
      renderAssigneeAvatars: () => null,
    });
    stubModule("src/lib/contexts/Calendar/calendar.context.tsx", {
      useCalendarContext: () => ({ projects: [], setCurrentTask: () => {} }),
    });

    const jiti = jitiModule.createJiti
      ? jitiModule.createJiti(__filename, {
          interopDefault: true,
          jsx: true,
          alias: { "@": path.join(root, "src") },
        })
      : jitiModule(__filename, {
          interopDefault: true,
          jsx: true,
          alias: { "@": path.join(root, "src") },
        });
    const { DaySection, TaskCard } = jiti(
      modulePath("src/components/PageComponents/Calendar/task-card.tsx"),
    );
    const blockedTask = task(6);
    const unblockedTask = task(null);
    const day = new Date("2026-08-31T00:00:00.000Z");
    const cardClassName = (calendarTask, view) => {
      const html = renderToStaticMarkup(
        React.createElement(TaskCard, {
          task: calendarTask,
          taskDay: day,
          index: 0,
          active: false,
          handleTaskClick: () => {},
          view,
        }),
      );
      return new JSDOM(html).window.document.querySelector(".kanban-task-card")
        .className;
    };

    for (const view of ["month", "week"]) {
      assert.match(
        cardClassName(blockedTask, view),
        /border-\[hsl\(0_62\.8%_30\.6%\)\]/,
      );
      assert.match(cardClassName(unblockedTask, view), /border-transparent/);
    }

    const dayHtml = renderToStaticMarkup(
      React.createElement(DaySection, {
        day,
        dayIndex: 0,
        provided: { droppableProps: {}, innerRef: () => {}, placeholder: null },
        currentDay: day,
        currentTask: -1,
        view: "day",
        toggleDueDateModal: () => {},
        getTasksForDate: () => [blockedTask, unblockedTask],
        handleTaskClick: () => {},
      }),
    );
    const dayDocument = new JSDOM(dayHtml).window.document;
    assert.match(
      dayDocument.getElementById("task-2").className,
      /border-\[hsl\(0_62\.8%_30\.6%\)\]/,
    );
    assert.match(
      dayDocument.getElementById("task-1").className,
      /border-l-transparent/,
    );
  } finally {
    restoreStubs();
    if (previousDnd === undefined) delete require.cache[dndPath];
    else require.cache[dndPath] = previousDnd;
    if (previousReact === undefined) delete global.React;
    else global.React = previousReact;
  }
});
