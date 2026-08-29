const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/inbox-important-split.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { getInboxTabs } = jiti(
  path.join(root, "src/utils/helperFunctions/helperFunctions.ts")
);
const { getInboxSplitKey, getShowImportantSplit } = jiti(
  path.join(root, "src/lib/inboxSplitSettings.ts")
);

let nextId = 1;
const notif = (over) => ({
  id: nextId++,
  projectId: 15,
  taskId: nextId,
  seen: false,
  fromAgentId: null,
  project: { title: "Product", name: "product" },
  ...over,
});

const splitOf = (notification) => {
  const { tabs, data } = getInboxTabs([notification]);
  return tabs.filter((tab) => data[tab.idx].length > 0 && tab.projectId === null)
    .map((tab) => tab.project)
    .filter((name) => name !== "All");
};

const tabIndices = (notifications, splitsNoImportant = []) => {
  const { tabs, data } = getInboxTabs(notifications, splitsNoImportant);
  return Object.fromEntries(tabs.map((tab) => [tab.project, data[tab.idx]]));
};

// HTPR-4940: per-split duplication into Important defaults on and can be muted.
test("mention in a muted project split stays in its home split only", () => {
  const mention = notif({ type: "Mentioned" });
  const projectKey = getInboxSplitKey({ project: "Product", projectId: 15 });
  const tabs = tabIndices([mention], [projectKey]);

  assert.deepEqual(tabs.Product, [0]);
  assert.deepEqual(tabs["@Mentions"], [0]);
  assert.equal(tabs.Important, undefined);
});

test("unmuted project split keeps mention duplication by default", () => {
  const mention = notif({ type: "Mentioned" });
  const tabs = tabIndices([mention]);

  assert.deepEqual(tabs.Product, [0]);
  assert.deepEqual(tabs.Important, [0]);
});

test("muted project reroutes an Important-primary comment to its project split", () => {
  const projectKey = getInboxSplitKey({ project: "Product", projectId: 15 });
  const mutedTabs = tabIndices([notif({ type: "Comment" })], [projectKey]);
  const defaultTabs = tabIndices([notif({ type: "Comment" })]);

  assert.deepEqual(mutedTabs.Product, [0]);
  assert.equal(mutedTabs.Important, undefined);
  assert.deepEqual(defaultTabs.Product, [0]);
  assert.deepEqual(defaultTabs.Important, [0]);
});

test("muting one project split does not affect another", () => {
  const mutedMention = notif({ type: "Mentioned" });
  const otherMention = notif({
    type: "Mentioned",
    projectId: 16,
    project: { title: "Other", name: "other" },
  });
  const projectKey = getInboxSplitKey({ project: "Product", projectId: 15 });
  const tabs = tabIndices([mutedMention, otherMention], [projectKey]);

  assert.deepEqual(tabs.Product, [0]);
  assert.deepEqual(tabs.Other, [1]);
  assert.deepEqual(tabs.Important, [1]);
});

// HTPR-4712: Important is only for things waiting on you.
test("agent property change lands in the Agents split, not Important", () => {
  assert.deepEqual(
    splitOf(notif({ type: "TaskDueDate", fromAgentId: "agent-1", agentOnlyTypes: ["TaskDueDate"] })),
    ["Agents"]
  );
});

test("agent routine comment lands in the Agents split, not Important", () => {
  assert.deepEqual(
    splitOf(notif({ type: "Comment", fromAgentId: "agent-1", agentOnlyTypes: ["Comment"] })),
    ["Agents"]
  );
});

test("direct agent reply lands in Important even when routine agent comments are filtered", () => {
  assert.deepEqual(
    splitOf(
      notif({
        type: "Mentioned",
        fromAgentId: "agent-1",
        agentOnlyTypes: ["Mentioned"],
        directReply: true,
        userId: 6,
        task: aliveTask({ assignees: [] }),
      })
    ).sort(),
    ["@Mentions", "Important"]
  );
});

test("direct agent reply bypasses a project's routine Important mute", () => {
  const projectKey = getInboxSplitKey({ project: "Product", projectId: 15 });
  const tabs = tabIndices(
    [
      notif({
        type: "Mentioned",
        fromAgentId: "agent-1",
        agentOnlyTypes: ["Mentioned"],
        directReply: true,
        userId: 6,
        task: aliveTask({ assignees: [] }),
      }),
    ],
    [projectKey]
  );

  assert.deepEqual(tabs.Important, [0]);
});

test("direct reply from a muted agent still reaches Important", () => {
  assert.deepEqual(
    splitOf(
      notif({
        type: "Mentioned",
        fromAgentId: "agent-1",
        agentOnlyTypes: ["Mentioned"],
        mutedTypes: ["Mentioned"],
        directReply: true,
        userId: 6,
        task: aliveTask({ assignees: [] }),
      })
    ).sort(),
    ["@Mentions", "Important"]
  );
});

test("an agent without Important permission keeps its direct reply in Agents", () => {
  assert.deepEqual(
    splitOf(
      notif({
        type: "Mentioned",
        fromAgentId: "agent-1",
        agentOnlyTypes: ["Mentioned"],
        mutedTypes: ["Mentioned"],
        directReply: true,
        directReplyTypes: [],
        userId: 6,
        task: aliveTask({ assignees: [] }),
      })
    ),
    ["Agents"]
  );
});

test("later muted agent chatter does not replace the direct answer", () => {
  assert.deepEqual(
    splitOf(
      notif({
        type: "Comment",
        fromAgentId: "agent-1",
        activeNotificationTypes: ["Comment", "Mentioned"],
        agentOnlyTypes: ["Comment", "Mentioned"],
        mutedTypes: ["Comment", "Mentioned"],
        directReply: true,
        directReplyTypes: ["Mentioned"],
        userId: 6,
        task: aliveTask({ assignees: [] }),
      })
    ).sort(),
    ["@Mentions", "Important"]
  );
});

test("direct reply reaches Important even when the task is archived", () => {
  const splits = splitOf(
    notif({
      type: "Mentioned",
      fromAgentId: "agent-1",
      agentOnlyTypes: ["Mentioned"],
      directReply: true,
      userId: 6,
      task: aliveTask({ status: "Archive", assignees: [] }),
    })
  );

  assert.equal(splits.includes("Important"), true);
});

test("direct reply reaches Important even when the task is stale", () => {
  const splits = splitOf(
    notif({
      type: "Mentioned",
      fromAgentId: "agent-1",
      agentOnlyTypes: ["Mentioned"],
      directReply: true,
      userId: 6,
      task: aliveTask({
        sectionChangedAt: new Date(Date.now() - 30 * 864e5).toISOString(),
        assignees: [],
      }),
    })
  );

  assert.equal(splits.includes("Important"), true);
});

test("guest preference keeps an empty Important split beside four agent assignments", () => {
  const notifications = Array.from({ length: 4 }, (_, index) =>
    notif({
      type: "Assigned",
      taskId: 100 + index,
      fromAgentId: "agent-1",
      agentOnlyTypes: ["Assigned"],
    })
  );
  const { tabs, data } = getInboxTabs(notifications, [], true);
  const indices = Object.fromEntries(
    tabs.map((tab) => [tab.project, data[tab.idx]])
  );

  assert.deepEqual(indices.Agents, [0, 1, 2, 3]);
  assert.deepEqual(indices.Important, []);
  assert.equal(getShowImportantSplit({ showImportantSplit: true }), true);
  assert.equal(getShowImportantSplit({}), false);
});

test("agent mention still reaches Important", () => {
  assert.deepEqual(
    splitOf(notif({ type: "Mentioned", fromAgentId: "agent-1", agentOnlyTypes: ["Mentioned"] })).sort(),
    ["@Mentions", "Important"]
  );
});

test("human comment stays Important", () => {
  assert.deepEqual(splitOf(notif({ type: "Comment", agentOnlyTypes: [] })), ["Important"]);
});

// The agent's comment outranks Assigned in split order, but demoting on it would bury a
// real human assignment, so the chore must be skipped when picking the effective type.
test("agent comment does not drag a human event out of Important", () => {
  assert.deepEqual(
    splitOf(
      notif({
        type: "Comment",
        fromAgentId: "agent-1",
        activeNotificationTypes: ["Comment", "Assigned"],
        agentOnlyTypes: ["Comment"],
      })
    ),
    ["Important"]
  );
});

// HTPR-4769: Important = names you, on a task still alive.
const aliveTask = (over) => ({
  status: "Normal",
  section: "Doing",
  updatedAt: new Date(Date.now() - 2 * 864e5).toISOString(),
  sectionChangedAt: new Date(Date.now() - 2 * 864e5).toISOString(),
  assignees: [],
  ...over,
});

test("comment on a followed task you are not assigned to is Updates, not Important", () => {
  assert.deepEqual(
    splitOf(notif({ type: "Comment", agentOnlyTypes: [], userId: 6, task: aliveTask() })),
    ["Updates"]
  );
});

test("comment on a task assigned to you stays Important", () => {
  assert.deepEqual(
    splitOf(
      notif({ type: "Comment", agentOnlyTypes: [], userId: 6, task: aliveTask({ assignees: [{ userId: 6 }] }) })
    ),
    ["Important"]
  );
});

test("assignment stays Important without being an assignee row", () => {
  assert.deepEqual(
    splitOf(notif({ type: "Assigned", agentOnlyTypes: [], userId: 6, task: aliveTask() })),
    ["Important"]
  );
});

test("archived task demotes Important to Updates", () => {
  assert.deepEqual(
    splitOf(
      notif({
        type: "Comment",
        agentOnlyTypes: [],
        userId: 6,
        task: aliveTask({ status: "Archive", assignees: [{ userId: 6 }] }),
      })
    ),
    ["Updates"]
  );
});

test("stale task (22 days without human activity) demotes Important to Updates", () => {
  assert.deepEqual(
    splitOf(
      notif({
        type: "Comment",
        agentOnlyTypes: [],
        userId: 6,
        task: aliveTask({
          // bot bumps keep updatedAt fresh; the clock ignores it
          updatedAt: new Date().toISOString(),
          sectionChangedAt: new Date(Date.now() - 22 * 864e5).toISOString(),
          assignees: [{ userId: 6 }],
        }),
      })
    ),
    ["Updates"]
  );
});

test("a fresh human comment keeps a bot-bumped task alive", () => {
  assert.deepEqual(
    splitOf(
      notif({
        type: "Comment",
        agentOnlyTypes: [],
        userId: 6,
        task: aliveTask({
          sectionChangedAt: new Date(Date.now() - 30 * 864e5).toISOString(),
          comments: [{ createdAt: new Date(Date.now() - 1 * 864e5).toISOString() }],
          assignees: [{ userId: 6 }],
        }),
      })
    ),
    ["Important"]
  );
});

test("Done column demotes Important, but a mention newer than the move survives", () => {
  const doneTask = aliveTask({
    section: "Done",
    sectionChangedAt: new Date(Date.now() - 864e5).toISOString(),
    assignees: [{ userId: 6 }],
  });
  assert.deepEqual(
    splitOf(notif({ type: "Comment", agentOnlyTypes: [], userId: 6, task: doneTask })),
    ["Updates"]
  );
  assert.deepEqual(
    splitOf(
      notif({
        type: "Mentioned",
        agentOnlyTypes: [],
        userId: 6,
        createdAt: new Date().toISOString(),
        task: doneTask,
      })
    ).sort(),
    ["@Mentions", "Important"]
  );
});

// Stale split: only on boards with staleness tracking on; Updates elsewhere.
test("stale task on a staleness-enabled board lands in Stale", () => {
  assert.deepEqual(
    splitOf(
      notif({
        type: "Comment",
        agentOnlyTypes: [],
        userId: 6,
        project: { title: "Product", name: "product", stalenessEnabled: true },
        task: aliveTask({ sectionChangedAt: new Date(Date.now() - 22 * 864e5).toISOString() }),
      })
    ),
    ["Stale"]
  );
});

test("stale task on a board without staleness tracking stays in Updates", () => {
  assert.deepEqual(
    splitOf(
      notif({
        type: "Comment",
        agentOnlyTypes: [],
        userId: 6,
        project: { title: "Product", name: "product", stalenessEnabled: false },
        task: aliveTask({ sectionChangedAt: new Date(Date.now() - 22 * 864e5).toISOString() }),
      })
    ),
    ["Updates"]
  );
});

test("natural Updates row (TaskMoved) on a stale task also shelves to Stale", () => {
  assert.deepEqual(
    splitOf(
      notif({
        type: "TaskMoved",
        agentOnlyTypes: [],
        userId: 6,
        project: { title: "Product", name: "product", stalenessEnabled: true },
        task: aliveTask({ sectionChangedAt: new Date(Date.now() - 22 * 864e5).toISOString() }),
      })
    ),
    ["Stale"]
  );
});

test("archived task never shelves to Stale, even when idle", () => {
  assert.deepEqual(
    splitOf(
      notif({
        type: "Comment",
        agentOnlyTypes: [],
        userId: 6,
        project: { title: "Product", name: "product", stalenessEnabled: true },
        task: aliveTask({
          status: "Archive",
          sectionChangedAt: new Date(Date.now() - 22 * 864e5).toISOString(),
        }),
      })
    ),
    ["Updates"]
  );
});

test("rows without task data behave exactly as before (agent inbox fallback)", () => {
  assert.deepEqual(splitOf(notif({ type: "Comment", agentOnlyTypes: [], userId: 6 })), ["Important"]);
});

// The agent touched the same task, but a human wrote the comment: it must not be demoted.
test("human comment is not demoted when an agent also touched the task", () => {
  assert.deepEqual(
    splitOf(
      notif({
        type: "TaskDueDate",
        fromAgentId: "agent-1",
        activeNotificationTypes: ["Comment", "TaskDueDate"],
        agentOnlyTypes: ["TaskDueDate"],
      })
    ),
    ["Important"]
  );
});

test("muted agent mention lands only in Agents", () => {
  assert.deepEqual(
    splitOf(
      notif({
        type: "Mentioned",
        fromAgentId: "agent-1",
        mutedTypes: ["Mentioned"],
      })
    ),
    ["Agents"]
  );
});

test("muted agent comment lands in Agents", () => {
  assert.deepEqual(
    splitOf(
      notif({
        type: "Comment",
        fromAgentId: "agent-1",
        mutedTypes: ["Comment"],
      })
    ),
    ["Agents"]
  );
});

test("human comment on a task with muted agent activity stays Important", () => {
  assert.deepEqual(
    splitOf(
      notif({
        type: "TaskDueDate",
        fromAgentId: "agent-1",
        activeNotificationTypes: ["Comment", "TaskDueDate"],
        mutedTypes: ["TaskDueDate"],
      })
    ),
    ["Important"]
  );
});
