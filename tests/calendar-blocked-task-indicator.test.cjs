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

const blockingUser = {
  id: 6,
  displayName: "Valentin Yeo",
  photoURL: "https://example.com/valentin.jpg",
};

const blockingTask = (id, title = "Blocking task") => ({
  id,
  projectId: 15,
  uniqueIndex: id,
  ticketNumber: `HTPR-${id}`,
  title,
  status: "Normal",
  section: "In Progress",
});

const task = (waitingOnUserId, blockingTasks = []) => {
  const hasBlockingUser =
    waitingOnUserId !== null && waitingOnUserId !== undefined;
  let id = hasBlockingUser ? 2 : 1;
  if (blockingTasks.length > 0) id = 3;

  return {
    id,
    uniqueIndex: id,
    ticketNumber: `HTPR-${id}`,
    title: id === 1 ? "Ready task" : "Blocked task",
    projectId: 15,
    dueDate: new Date("2026-08-31T12:00:00.000Z"),
    waitingOnUserId,
    waitingOnUser: hasBlockingUser ? blockingUser : null,
    blockingTasks,
    assignees: [],
    taskLabels: [],
    _count: { comments: 0, savedContent: 0 },
  };
};

test("mobile agenda cards show the blocked indicator", () => {
  const previousReact = global.React;

  try {
    global.React = React;
    stubModule("src/lib/state.tsx", {
      useRecoilValue: () => null,
      useSetRecoilState: () => () => {},
    });
    stubModule("src/store/index.ts", {
      calendarSettingsAtom: {},
      currentUserAtom: {},
      mobileTopBarTitleAtom: {},
    });
    stubModule("src/components/Common/Calendar/index.tsx", {
      Calendar: () => null,
    });
    stubModule("src/lib/contexts/Calendar/calendar.context.tsx", {
      useCalendarContext: () => ({}),
    });
    stubModule("src/lib/configs/ calendar.config.ts", {
      calendarConfig: { constants: { day_names: [], month_names: [] } },
    });
    stubModule("src/hooks/General/useGetUserDrafts.ts", {
      useGetUserDrafts: () => ({ draftTaskIds: new Set() }),
    });
    stubModule("src/components/PageComponents/Calendar/CalendarSplitsRow.tsx", {
      default: () => null,
    });
    stubModule(
      "src/components/PageComponents/Kanban/KanbanTaskComponents/KanbanTaskCard.tsx",
      {
        default: ({ blockingUser, task: calendarTask }) =>
          React.createElement(
            "div",
            {
              "data-blocking-user": blockingUser?.id ?? "",
              "data-blocking-tasks": calendarTask.blockingTasks?.length ?? 0,
            },
            blockingUser?.displayName,
          ),
      },
    );

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
    const { AgendaRow } = jiti(
      modulePath("src/components/PageComponents/Calendar/MobileCalendar.tsx"),
    );
    const renderAgendaRow = (calendarTask) =>
      new JSDOM(
        renderToStaticMarkup(
          React.createElement(AgendaRow, {
            task: calendarTask,
            project: undefined,
            hasDraft: false,
            onOpen: () => {},
          }),
        ),
      ).window.document;

    const blockedRow = renderAgendaRow(task(6));
    assert.match(blockedRow.body.textContent, /Valentin Yeo/);
    assert.equal(
      blockedRow.querySelector("[data-blocking-user]").dataset.blockingUser,
      "6",
    );
    assert.doesNotMatch(renderAgendaRow(task(null)).body.textContent, /Valentin Yeo/);
    assert.equal(
      renderAgendaRow(task(null, [blockingTask(1606)])).querySelector("[data-blocking-tasks]").dataset.blockingTasks,
      "1",
    );
  } finally {
    restoreStubs();
    if (previousReact === undefined) delete global.React;
    else global.React = previousReact;
  }
});

test("calendar cards show person and task blockers in month, week, and day views", () => {
  const dndPath = require.resolve("@hello-pangea/dnd");
  const previousDnd = require.cache[dndPath];
  const previousReact = global.React;
  const navigations = [];

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
    stubModule("src/hooks/MultiPages/Route/useHypertasksNavigate.ts", {
      default: () => ({
        navigateToTask: (...args) => navigations.push(args),
      }),
    });
    stubModule("src/components/Common/Tooltip.tsx", { default: () => null });
    stubModule("src/components/Common/UserAvatar.tsx", { default: () => null });
    require.cache[modulePath("src/components/Common/UserAvatar.tsx")].exports = {
      default: ({ name }) =>
        React.createElement("span", { "data-user-avatar": name }),
    };
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
    require.cache[
      modulePath("src/lib/contexts/Calendar/calendar.context.tsx")
    ].exports = {
      useCalendarContext: () => ({
        projects: [
          {
            id: 15,
            name: "hypertask-product",
            title: "Hypertask Product",
            members: [],
            labels: [],
            _count: { tasks: 2 },
          },
        ],
        setCurrentTask: () => {},
      }),
    };

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
    const taskBlockedByTasks = task(null, [
      blockingTask(1606, "First dependency"),
      blockingTask(1537, "Second dependency"),
    ]);
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
    const cardDocument = (calendarTask, view) => {
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
      return new JSDOM(html).window.document;
    };

    for (const view of ["month", "week"]) {
      assert.match(
        cardClassName(blockedTask, view),
        /border-\[hsl\(0_62\.8%_30\.6%\)\]/,
      );
      assert.match(
        cardClassName(taskBlockedByTasks, view),
        /border-\[hsl\(0_62\.8%_30\.6%\)\]/,
      );
      assert.match(cardClassName(unblockedTask, view), /border-transparent/);

      const taskBlockedCard = cardDocument(taskBlockedByTasks, view).querySelector(
        ".kanban-task-card",
      );
      assert.match(taskBlockedCard.textContent, /HTPR-1606/);
      assert.match(taskBlockedCard.textContent, /First dependency/);
      assert.match(taskBlockedCard.textContent, /HTPR-1537/);
      assert.match(taskBlockedCard.textContent, /Second dependency/);
      assert.equal(taskBlockedCard.querySelectorAll("[data-blocking-task]").length, 2);

      const blockedCard = cardDocument(blockedTask, view).querySelector(
        ".kanban-task-card",
      );
      assert.match(blockedCard.textContent, /Valentin Yeo/);
      assert.ok(
        blockedCard.querySelector('[data-user-avatar="Valentin Yeo"]'),
      );
      assert.doesNotMatch(
        cardDocument(unblockedTask, view).body.textContent,
        /Valentin Yeo/,
      );
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
        getTasksForDate: () => [blockedTask, taskBlockedByTasks, unblockedTask],
        handleTaskClick: () => {},
      }),
    );
    const dayDocument = new JSDOM(dayHtml).window.document;
    assert.match(
      dayDocument.getElementById("task-2").className,
      /border-\[hsl\(0_62\.8%_30\.6%\)\]/,
    );
    assert.match(
      dayDocument.getElementById("task-3").className,
      /border-\[hsl\(0_62\.8%_30\.6%\)\]/,
    );
    assert.match(
      dayDocument.getElementById("task-1").className,
      /border-l-transparent/,
    );
    assert.equal(
      dayDocument.getElementById("task-3").querySelectorAll("[data-blocking-task]").length,
      2,
    );

    const blockedDayRow = dayDocument.getElementById("task-2");
    assert.match(blockedDayRow.textContent, /Valentin Yeo/);
    assert.ok(
      blockedDayRow.querySelector('[data-user-avatar="Valentin Yeo"]'),
    );
    assert.doesNotMatch(
      dayDocument.getElementById("task-1").textContent,
      /Valentin Yeo/,
    );

    const { BlockerTaskChip } = jiti(
      modulePath("src/components/PageComponents/Kanban/KanbanTaskComponents/BlockerChip.tsx"),
    );
    const chip = BlockerTaskChip({ task: blockingTask(1606) });
    let defaultPrevented = false;
    let propagationStopped = false;
    const interaction = (key) => ({
      key,
      preventDefault: () => { defaultPrevented = true; },
      stopPropagation: () => { propagationStopped = true; },
    });
    assert.equal(chip.props.role, "link");
    assert.equal(chip.props.tabIndex, 0);
    assert.match(chip.props["aria-label"], /Open blocker HTPR-1606/);
    chip.props.onClick(interaction());
    assert.equal(defaultPrevented, true);
    assert.equal(propagationStopped, true);
    chip.props.onKeyDown(interaction("Escape"));
    assert.deepEqual(navigations, [[15, 1606]]);
    chip.props.onKeyDown(interaction("Enter"));
    chip.props.onKeyDown(interaction(" "));
    assert.deepEqual(navigations, [[15, 1606], [15, 1606], [15, 1606]]);
  } finally {
    restoreStubs();
    if (previousDnd === undefined) delete require.cache[dndPath];
    else require.cache[dndPath] = previousDnd;
    if (previousReact === undefined) delete global.React;
    else global.React = previousReact;
  }
});
