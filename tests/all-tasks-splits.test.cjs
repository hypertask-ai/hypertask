const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const jiti = require("jiti")(path.join(root, "tests/all-tasks-splits.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});

const {
  groupRecentTasksByProject,
  groupRecentTasksByDueDate,
} = jiti(path.join(root, "src/utils/controllers/tasks/recentTasksGrouping.ts"));

const stubModule = (relativePath, exports) => {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
};

const loadRecentTasksController = ({ projects, findMany }) => {
  const prismaPath = "src/lib/prisma.ts";
  const projectsPath = "src/utils/controllers/projects/getAllMinimal.ts";
  const controllerPath = "src/utils/controllers/tasks/recentTasks.ts";

  for (const relativePath of [prismaPath, projectsPath, controllerPath]) {
    delete require.cache[path.join(root, relativePath)];
  }
  stubModule(prismaPath, { default: { task: { findMany } } });
  stubModule(projectsPath, {
    default: async () => ({ json: projects }),
  });

  const controller = jiti(path.join(root, controllerPath)).default;
  return {
    controller,
    cleanup: () => {
      for (const relativePath of [prismaPath, projectsPath, controllerPath]) {
        delete require.cache[path.join(root, relativePath)];
      }
    },
  };
};

const minutesAgo = (minutes) =>
  new Date(Date.now() - minutes * 60 * 1000).toISOString();

const makeTasks = (projectTitle, count, startMinutesAgo) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${projectTitle}-${index}`,
    title: `${projectTitle} task ${index}`,
    updatedAt: minutesAgo(startMinutesAgo + index),
  }));

test("a quiet board keeps its own split even when a busy board fills the All tab", () => {
  const buckets = [
    // Busy board: 50 updates, all newer than anything on the quiet board.
    { title: "Hypertask", tasks: makeTasks("Hypertask", 50, 1) },
    // Quiet board: older, so a single global take(50) would drop it entirely.
    { title: "Inner", tasks: makeTasks("Inner", 3, 200) },
  ];

  const { tasksByProject, tabs } = groupRecentTasksByProject(buckets, 50);

  assert.deepEqual(tabs, ["All", "Hypertask", "Inner"]);
  assert.equal(tasksByProject.Inner.length, 3);
  assert.equal(tasksByProject.Hypertask.length, 50);
  assert.equal(tasksByProject.All.length, 50);
});

test("the All tab holds the globally most recent tasks across boards", () => {
  const buckets = [
    { title: "Hypertask", tasks: makeTasks("Hypertask", 2, 10) },
    { title: "Inner", tasks: makeTasks("Inner", 2, 1) },
  ];

  const { tasksByProject, tabs } = groupRecentTasksByProject(buckets, 50);

  assert.deepEqual(
    tasksByProject.All.map((task) => task.id),
    ["Inner-0", "Inner-1", "Hypertask-0", "Hypertask-1"]
  );
  // Most recently touched board leads the splits.
  assert.deepEqual(tabs, ["All", "Inner", "Hypertask"]);
});

test("boards with no recent tasks get no split, and untitled boards fall back", () => {
  const buckets = [
    { title: "Hypertask", tasks: makeTasks("Hypertask", 1, 5) },
    { title: "Empty", tasks: [] },
    { title: null, tasks: makeTasks("Nameless", 1, 6) },
  ];

  const { tasksByProject, tabs } = groupRecentTasksByProject(buckets, 50);

  assert.deepEqual(tabs, ["All", "Hypertask", "Uncategorized"]);
  assert.equal(tasksByProject.Empty, undefined);
  assert.equal(tasksByProject.Uncategorized.length, 1);
});

test("two boards sharing a title merge into one split, newest first", () => {
  const buckets = [
    { title: "Inbox", tasks: makeTasks("A", 1, 30) },
    { title: "Inbox", tasks: makeTasks("B", 1, 2) },
  ];

  const { tasksByProject, tabs } = groupRecentTasksByProject(buckets, 50);

  assert.deepEqual(tabs, ["All", "Inbox"]);
  assert.deepEqual(
    tasksByProject.Inbox.map((task) => task.id),
    ["B-0", "A-0"]
  );
});

test("due-date grouping keeps every board split and adds the personal tab", () => {
  const withDueDate = (tasks) =>
    tasks.map((task) => ({ ...task, dueDate: task.updatedAt }));
  const buckets = [
    { title: "Hypertask", tasks: withDueDate(makeTasks("Hypertask", 50, 1)) },
    {
      title: "Inner",
      tasks: [
        {
          id: "mine",
          updatedAt: minutesAgo(400),
          dueDate: minutesAgo(400),
          userId: "6",
        },
      ],
    },
  ];

  const { tasksByDueDate, tabs } = groupRecentTasksByDueDate(
    buckets,
    buckets[1].tasks,
    50
  );

  assert.equal(tabs[0], "All Due Dates");
  assert.ok(tabs.includes("Inner"));
  assert.equal(tasksByDueDate.Inner.length, 1);
  assert.equal(tasksByDueDate["All Due Dates"].length, 50);
  // "All" is replaced by "All Due Dates" and must not linger as a stray split.
  assert.equal(tasksByDueDate.All, undefined);
  assert.equal(tabs.filter((tab) => tab === "All").length, 0);
});

test("due-date grouping orders by due date, not by last update", () => {
  const buckets = [
    {
      title: "Hypertask",
      tasks: [
        { id: "soon", updatedAt: minutesAgo(500), dueDate: minutesAgo(1) },
        { id: "later", updatedAt: minutesAgo(1), dueDate: minutesAgo(500) },
      ],
    },
  ];

  const { tasksByDueDate } = groupRecentTasksByDueDate(buckets, [], 50);

  assert.deepEqual(
    tasksByDueDate["All Due Dates"].map((task) => task.id),
    ["soon", "later"]
  );
});

test("every tab name has a matching task list", () => {
  const buckets = [
    { title: "Hypertask", tasks: makeTasks("Hypertask", 4, 1) },
    { title: "Inner", tasks: makeTasks("Inner", 2, 90) },
    { title: null, tasks: makeTasks("Nameless", 1, 300) },
  ];

  for (const result of [
    groupRecentTasksByProject(buckets, 50),
    groupRecentTasksByDueDate(buckets, [], 50),
  ]) {
    const lists = result.tasksByProject ?? result.tasksByDueDate;
    for (const tab of result.tabs) {
      assert.ok(Array.isArray(lists[tab]), `missing task list for tab ${tab}`);
    }
  }
});

test("the personal due-date tab exists and holds the user's own task", () => {
  const withDueDate = (tasks) =>
    tasks.map((task) => ({ ...task, dueDate: task.updatedAt }));
  const buckets = [
    { title: "Hypertask", tasks: withDueDate(makeTasks("Hypertask", 5, 10)) },
    {
      title: "Inner",
      tasks: [
        { id: "mine", updatedAt: minutesAgo(1), dueDate: minutesAgo(1), userId: "6" },
      ],
    },
  ];

  const { tasksByDueDate, tabs } = groupRecentTasksByDueDate(
    buckets,
    buckets[1].tasks,
    50
  );

  assert.ok(tabs.includes("My Due Dates"));
  assert.deepEqual(
    tasksByDueDate["My Due Dates"].map((task) => task.id),
    ["mine"]
  );
});

test("reserved tab renaming does not consume another board's real title", () => {
  const buckets = [
    { title: "All", tasks: makeTasks("All", 2, 1) },
    { title: "All (board)", tasks: makeTasks("All board", 2, 3) },
    { title: "Hypertask", tasks: makeTasks("Hypertask", 2, 5) },
  ];

  const { tasksByProject, tabs, allTasks } = groupRecentTasksByProject(buckets, 50);

  assert.equal(allTasks.length, 6);
  assert.equal(tasksByProject.All.length, 6);
  assert.equal(tasksByProject["All (board)"].length, 2);
  assert.equal(tasksByProject["All (board 2)"].length, 2);
  assert.ok(tabs.includes("All (board)"));
  assert.ok(tabs.includes("All (board 2)"));
});

test("due-date board titles cannot overwrite either synthetic due tab", () => {
  const dueTask = (id, minutes) => ({
    id,
    updatedAt: minutesAgo(minutes),
    dueDate: minutesAgo(minutes),
  });
  const buckets = [
    { title: "All Due Dates", tasks: [dueTask("all-board", 1)] },
    { title: "My Due Dates", tasks: [dueTask("my-board", 2)] },
  ];
  const personalTasks = [dueTask("personal", 3)];

  const { tasksByDueDate, tabs } = groupRecentTasksByDueDate(
    buckets,
    personalTasks,
    50
  );

  assert.deepEqual(
    tasksByDueDate["All Due Dates"].map((task) => task.id),
    ["all-board", "my-board"]
  );
  assert.deepEqual(
    tasksByDueDate["My Due Dates"].map((task) => task.id),
    ["personal"]
  );
  assert.equal(tasksByDueDate["All Due Dates (board)"].length, 1);
  assert.equal(tasksByDueDate["My Due Dates (board)"].length, 1);
  assert.ok(tabs.includes("All Due Dates (board)"));
  assert.ok(tabs.includes("My Due Dates (board)"));
});

test("a board titled __proto__ is stored as plain data", () => {
  const buckets = [{ title: "__proto__", tasks: makeTasks("proto", 2, 1) }];

  const { tasksByProject, tabs } = groupRecentTasksByProject(buckets, 50);

  assert.ok(tabs.includes("__proto__"));
  assert.equal(tasksByProject.__proto__.length, 2);
  assert.equal(Object.prototype.toString.call({}), "[object Object]");
});

test("the personal due-date tab keeps a task that falls outside the global top 50", () => {
  const withDueDate = (tasks) =>
    tasks.map((task) => ({ ...task, dueDate: task.updatedAt }));
  const buckets = [
    // 50 newer tasks on a busy board fill the global limit entirely.
    { title: "Hypertask", tasks: withDueDate(makeTasks("Hypertask", 50, 1)) },
    {
      title: "Inner",
      tasks: [
        { id: "mine", updatedAt: minutesAgo(400), dueDate: minutesAgo(400), userId: "6" },
      ],
    },
  ];

  const { tasksByDueDate, tabs } = groupRecentTasksByDueDate(
    buckets,
    buckets[1].tasks,
    50
  );

  assert.ok(tabs.includes("My Due Dates"));
  assert.deepEqual(
    tasksByDueDate["My Due Dates"].map((task) => task.id),
    ["mine"]
  );
});

test("empty input still returns matching tabs and lists", () => {
  const empty = groupRecentTasksByProject([], 50);
  assert.deepEqual(empty.tabs, ["All"]);
  assert.deepEqual(empty.tasksByProject.All, []);

  const emptyDue = groupRecentTasksByDueDate(
    [{ title: "Inner", tasks: [] }],
    [],
    50
  );
  assert.deepEqual(emptyDue.tabs, ["All Due Dates"]);
  assert.deepEqual(emptyDue.tasksByDueDate["All Due Dates"], []);
  assert.equal(emptyDue.tasksByDueDate["My Due Dates"], undefined);
});

test("All Tasks applies the selected updated-at range without excluding archived tasks", async () => {
  const projects = [{ id: 1, title: "Board 1" }];
  const queries = [];
  const findMany = async (query) => {
    queries.push(query);
    return [];
  };

  const { controller, cleanup } = loadRecentTasksController({ projects, findMany });
  try {
    await controller(6, "All");
    await controller(6, "All", "all");

    const lastSevenDaysQuery = queries[0];
    assert.ok(lastSevenDaysQuery.where.updatedAt.gte instanceof Date);
    assert.equal(lastSevenDaysQuery.where.updatedAt.not, undefined);
    assert.equal(lastSevenDaysQuery.where.status, undefined);
    assert.ok(
      Date.now() - lastSevenDaysQuery.where.updatedAt.gte.getTime() >=
        7 * 24 * 60 * 60 * 1000
    );

    assert.deepEqual(queries[1].where.updatedAt, { not: null });
  } finally {
    cleanup();
  }
});

test("the Last 24 hours range filters to roughly one day", async () => {
  const projects = [{ id: 1, title: "Board 1" }];
  const queries = [];
  const findMany = async (query) => {
    queries.push(query);
    return [];
  };

  const { controller, cleanup } = loadRecentTasksController({ projects, findMany });
  try {
    const before = Date.now();
    await controller(6, "All", "24");
    const after = Date.now();

    const gte = queries[0].where.updatedAt.gte.getTime();
    assert.ok(gte >= before - 24 * 60 * 60 * 1000);
    assert.ok(gte <= after - 24 * 60 * 60 * 1000);
  } finally {
    cleanup();
  }
});

test("due-date loading caps board queries and fetches the personal tab separately", async () => {
  const projects = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    title: `Board ${index + 1}`,
  }));
  const queries = [];
  let activeBoardQueries = 0;
  let peakBoardQueries = 0;
  const mine = {
    id: "mine-outside-board-limit",
    title: "My older due task",
    projectId: 1,
    project: { id: 1, title: "Board 1" },
    updatedAt: minutesAgo(500),
    dueDate: minutesAgo(500),
    userId: 9,
    assignees: [{ userId: 6, agentId: null, user: { displayName: "Valentin" } }],
  };

  const findMany = async (query) => {
    queries.push(query);
    if (Array.isArray(query.where.projectId?.in)) return [mine];

    activeBoardQueries += 1;
    peakBoardQueries = Math.max(peakBoardQueries, activeBoardQueries);
    await Promise.resolve();
    activeBoardQueries -= 1;

    const projectId = query.where.projectId;
    return [
      {
        id: `board-${projectId}`,
        title: `Board ${projectId} newest due task`,
        projectId,
        project: { id: projectId, title: `Board ${projectId}` },
        updatedAt: minutesAgo(projectId),
        dueDate: minutesAgo(projectId),
        userId: 9,
      },
    ];
  };

  const { controller, cleanup } = loadRecentTasksController({ projects, findMany });
  try {
    const result = await controller(6, "DueDate");
    const personalQuery = queries.find((query) =>
      Array.isArray(query.where.projectId?.in)
    );

    assert.equal(peakBoardQueries, 6);
    assert.equal(queries.length, 9);
    assert.equal(personalQuery.take, 50);
    assert.ok(
      queries
        .filter((query) => !Array.isArray(query.where.projectId?.in))
        .every((query) => query.take === 50)
    );
    assert.deepEqual(personalQuery.where.OR, [
      { assignees: { some: { userId: 6, agentId: null } } },
      { assignees: { none: {} }, userId: 6 },
    ]);
    assert.deepEqual(
      result.All["My Due Dates"].map((task) => task.id),
      ["mine-outside-board-limit"]
    );
  } finally {
    cleanup();
  }
});
