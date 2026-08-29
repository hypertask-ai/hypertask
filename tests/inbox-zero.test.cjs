const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NotificationType, Status } = require("@prisma/client");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  evaluateInboxZero,
  inboxZeroDoneNameFallback,
  loadDoneTitlesByProject,
} = jiti(
  path.join(root, "src/utils/controllers/notifications/inboxZero.ts")
);
const { visibleUserInboxWhere } = jiti(
  path.join(
    root,
    "src/utils/controllers/notifications/visibleInboxScope.ts"
  )
);
const { blockerStillOpen } = jiti(
  path.join(root, "src/lib/mcp/tasks/blockerStillOpen.ts")
);
const { DEFAULT_INBOX_ZERO_RULES, INBOX_ZERO_PRESETS } = jiti(
  path.join(root, "src/lib/inboxZero.ts")
);
const { getAllCommands } = jiti(
  path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts")
);
const { CommandMode } = jiti(path.join(root, "src/models/enums.ts"));
const { getInboxTabs } = jiti(
  path.join(root, "src/utils/helperFunctions/helperFunctions.ts")
);

const now = new Date("2026-07-22T12:00:00.000Z");
const task = (status = Status.Normal, section = "Todo", dueDate = null) => ({
  status,
  section,
  projectId: 1,
  dueDate,
});
const notification = ({
  id,
  type = NotificationType.Comment,
  seen = true,
  createdAt = "2026-07-21T12:00:00.000Z",
  fromUserId = 8,
  taskId = id,
  notificationInviteId = null,
  linkedTask = task(),
}) => ({
  id,
  notification_inviteId: notificationInviteId,
  type,
  seen,
  createdAt: new Date(createdAt),
  fromUserId,
  taskId,
  task: linkedTask,
});

test("Inbox Zero keep rules win and overlapping categories archive once", () => {
  const rows = [
    notification({ id: 1, createdAt: "2026-07-01T12:00:00.000Z" }),
    notification({
      id: 2,
      type: NotificationType.Reacted,
      seen: false,
      createdAt: "2026-07-01T12:00:00.000Z",
    }),
    notification({
      id: 3,
      type: NotificationType.Mentioned,
      createdAt: "2026-07-01T12:00:00.000Z",
    }),
    notification({
      id: 4,
      type: NotificationType.Comment,
      fromUserId: 6,
      createdAt: "2026-07-01T12:00:00.000Z",
    }),
    notification({
      id: 5,
      type: NotificationType.TaskArchived,
      linkedTask: task(Status.Archive),
    }),
  ];

  const result = evaluateInboxZero(rows, 6, DEFAULT_INBOX_ZERO_RULES, now);

  assert.deepEqual(new Set(result.notificationIds), new Set([1, 4]));
  assert.equal(result.categoryCounts.read, 2);
  assert.equal(result.categoryCounts.ownActions, 1);
  assert.equal(result.totalToArchive, 2);
  assert.equal(result.totalLeft, 3);
});

test("Inbox Zero keeps only the newest move or edit per task", () => {
  const rows = [
    notification({
      id: 11,
      type: NotificationType.TaskMoved,
      taskId: 50,
      createdAt: "2026-07-20T12:00:00.000Z",
    }),
    notification({
      id: 12,
      type: NotificationType.TaskUpdateDescription,
      taskId: 50,
      createdAt: "2026-07-21T12:00:00.000Z",
    }),
    notification({
      id: 13,
      type: NotificationType.TaskMoved,
      taskId: 51,
      createdAt: "2026-07-21T12:00:00.000Z",
    }),
  ];
  const rules = {
    ...DEFAULT_INBOX_ZERO_RULES,
    categories: {
      ...DEFAULT_INBOX_ZERO_RULES.categories,
      read: false,
      reactions: false,
      ownActions: false,
      pastReminders: false,
    },
  };

  const result = evaluateInboxZero(rows.reverse(), 6, rules, now);

  assert.deepEqual(new Set(result.notificationIds), new Set([11, 12]));
  assert.equal(result.categoryCounts.superseded, 1);
  assert.equal(result.totalActive, 2);
  assert.equal(result.totalToArchive, 1);
  assert.equal(result.totalLeft, 1);
});

test("done titles load once and stay scoped to each blocker project", async () => {
  const queries = [];
  const db = {
    section: {
      findMany: async (query) => {
        queries.push(query);
        return [
          { projectId: 1, section_title: "QA Passed", isDone: false },
          { projectId: 2, section_title: "QA Passed", isDone: true },
        ];
      },
    },
  };

  const doneTitlesByProject = await loadDoneTitlesByProject(
    [1, 2, 2],
    inboxZeroDoneNameFallback,
    db
  );

  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].where.projectId.in, [1, 2]);
  assert.equal(
    blockerStillOpen(
      { status: "Normal", section: "QA Passed" },
      doneTitlesByProject.get(1)
    ),
    true
  );
  assert.equal(
    blockerStillOpen(
      { status: "Normal", section: "QA Passed" },
      doneTitlesByProject.get(2)
    ),
    false
  );
});

// WHY: Boards without explicit flags must not have new reminders cleared by Inbox Zero.
test("Inbox Zero's null-flag fallback still matches only exactly Done", async () => {
  const db = {
    section: {
      findMany: async () => [
        { projectId: 1, section_title: "Shipped", isDone: null },
      ],
    },
  };
  const doneTitlesByProject = await loadDoneTitlesByProject(
    [1],
    inboxZeroDoneNameFallback,
    db
  );
  const rules = {
    ...DEFAULT_INBOX_ZERO_RULES,
    categories: {
      read: false,
      reactions: false,
      ownActions: false,
      superseded: false,
      pastReminders: true,
    },
  };
  const rows = [
    notification({
      id: 20,
      type: NotificationType.TaskReminder,
      linkedTask: task(Status.Normal, "Shipped"),
    }),
  ];

  const result = evaluateInboxZero(
    rows,
    6,
    rules,
    now,
    doneTitlesByProject
  );

  assert.equal(inboxZeroDoneNameFallback(" Done "), true);
  assert.equal(inboxZeroDoneNameFallback("Shipped"), false);
  assert.equal(result.categoryCounts.pastReminders, 0);
  assert.deepEqual(result.notificationIds, []);
});

test("Inbox Zero protects a visible item when any grouped event is protected", () => {
  const rows = [
    notification({
      id: 30,
      taskId: 90,
      type: NotificationType.Comment,
      seen: true,
      createdAt: "2026-07-21T12:00:00.000Z",
    }),
    notification({
      id: 29,
      taskId: 90,
      type: NotificationType.Mentioned,
      seen: true,
      createdAt: "2026-07-01T12:00:00.000Z",
    }),
  ];
  const rules = {
    ...DEFAULT_INBOX_ZERO_RULES,
    threshold: 0,
    categories: {
      ...DEFAULT_INBOX_ZERO_RULES.categories,
      reactions: false,
      ownActions: false,
      superseded: false,
      pastReminders: false,
    },
  };

  const protectedResult = evaluateInboxZero(rows, 6, rules, now);
  assert.equal(protectedResult.totalActive, 1);
  assert.equal(protectedResult.totalToArchive, 0);
  assert.deepEqual(protectedResult.notificationIds, []);

  const unprotectedResult = evaluateInboxZero(
    rows,
    6,
    { ...rules, keep: { ...rules.keep, mentions: false } },
    now
  );
  assert.equal(unprotectedResult.totalToArchive, 1);
  assert.deepEqual(new Set(unprotectedResult.notificationIds), new Set([29, 30]));
});

test("Inbox Zero preview version changes when the visible Inbox changes", () => {
  const rules = {
    ...DEFAULT_INBOX_ZERO_RULES,
    threshold: 0,
    keep: { unread: false, mentions: false, assignments: false },
  };
  const first = evaluateInboxZero(
    [notification({ id: 40, taskId: 100 })],
    6,
    rules,
    now
  );
  const changed = evaluateInboxZero(
    [
      notification({ id: 40, taskId: 100 }),
      notification({ id: 41, taskId: 101 }),
    ],
    6,
    rules,
    now
  );

  assert.equal(first.previewVersion.length, 64);
  assert.notEqual(first.previewVersion, changed.previewVersion);
  assert.equal(changed.totalActive, 2);
});

test("Inbox Zero preview expires when an item crosses the age threshold", () => {
  const rules = {
    ...DEFAULT_INBOX_ZERO_RULES,
    threshold: 1,
    keep: { unread: false, mentions: false, assignments: false },
  };
  const rows = [
    notification({
      id: 42,
      taskId: 102,
      createdAt: "2026-07-21T12:00:00.000Z",
    }),
  ];
  const before = evaluateInboxZero(
    rows,
    6,
    rules,
    new Date("2026-07-22T11:59:00.000Z")
  );
  const after = evaluateInboxZero(
    rows,
    6,
    rules,
    new Date("2026-07-22T12:01:00.000Z")
  );

  assert.equal(before.totalToArchive, 0);
  assert.equal(after.totalToArchive, 1);
  assert.notEqual(before.previewVersion, after.previewVersion);
});

test("Inbox Zero uses the exact visible All-tab server scope", () => {
  const where = visibleUserInboxWhere(6);

  assert.equal(where.userId, 6);
  assert.equal(where.status, "Normal");
  assert.equal(where.archivedAt, null);
  assert.equal(where.agentId, null);
  // HTPR-5683: a live task, or an archived task whose reminder just returned
  // the row, both count as visible.
  assert.deepEqual(where.AND[0].OR, [
    { task: { status: "Normal" } },
    { task: { status: "Archive" }, returnedFromReminders: true },
  ]);
  assert.equal(where.NOT.fromUserId, 6);
  assert.equal(where.NOT.fromAgentId, null);
  assert.deepEqual(where.AND[1].OR[1], { taskId: null });
});

test("Inbox All excludes synthetic blocked rows from its denominator", () => {
  const rows = [
    {
      id: 1,
      type: NotificationType.Comment,
      taskId: 1,
      projectId: 15,
      project: { title: "Product", name: "product" },
      seen: true,
      fromAgentId: null,
    },
    {
      id: "-2",
      waitingOnSynthetic: true,
      type: NotificationType.TaskReminder,
      taskId: 2,
      projectId: 15,
      project: { title: "Product", name: "product" },
      seen: true,
      fromAgentId: null,
    },
  ];
  const { tabs, data } = getInboxTabs(rows);
  const indices = Object.fromEntries(
    tabs.map((tab) => [tab.project, data[tab.idx]])
  );

  assert.deepEqual(indices.All, [0]);
  assert.deepEqual(indices["Blocked by you"], [1]);
});

test("Inbox Zero execution requires a serializable matching preview", () => {
  const source = require("node:fs").readFileSync(
    path.join(
      root,
      "src/app/api/notifications/inbox-zero/execute/route.ts"
    ),
    "utf8"
  );

  assert.match(source, /preview\.previewVersion !== requestedPreviewVersion/);
  assert.match(source, /TransactionIsolationLevel\.Serializable/);
  assert.match(source, /status: 409/);
});

test("Inbox Zero command presets are registered without bare shortcuts", () => {
  const commands = getAllCommands({ context: "Others" }).flatMap(
    (group) => group.commandLists
  );
  const inboxCommands = commands.filter((command) =>
    [
      CommandMode.ClearInboxToZero,
      CommandMode.ArchiveAllReadNotifications,
      CommandMode.ArchiveReactionNotifications,
    ].includes(command.commandMode)
  );

  assert.deepEqual(
    inboxCommands.map((command) => command.name),
    ["Clear inbox to zero", "Archive all read", "Archive reactions"]
  );
  assert.ok(inboxCommands.every((command) => command.keyboard === undefined));
  assert.equal(INBOX_ZERO_PRESETS.allRead.threshold, 0);
});

test("Inbox Zero and archived inbox live in Ctrl+K, not the inbox header", () => {
  const source = require("node:fs").readFileSync(
    path.join(root, "src/app/inbox/Inbox.tsx"),
    "utf8"
  );
  const commands = getAllCommands({ context: "Others" }).flatMap(
    (group) => group.commandLists
  );

  assert.doesNotMatch(source, /text="Get to Inbox Zero"/);
  assert.doesNotMatch(source, /router\.push\("\/archived\?inbox=true"\)/);
  assert.ok(
    commands.some(
      (command) => command.commandMode === CommandMode.ClearInboxToZero
    )
  );
  assert.ok(
    commands.some(
      (command) => command.commandMode === CommandMode.GotoInboxArchives
    )
  );
});

// HTPR-5613: "Clear inbox to zero" in Ctrl+K archived the inbox on the spot.
// Inbox Zero is a two-step feature — preview, then confirm that exact preview —
// but the palette called executeInboxZero with rules only, and the hook filled in
// the missing previewVersion by fetching a preview and confirming it itself. The
// person never saw what was about to disappear. The confirm sheet still existed;
// nothing rendered it.
test("the command palette confirms before archiving the inbox", () => {
  const readSource = (rel) =>
    require("node:fs").readFileSync(path.join(root, rel), "utf8");
  const palette = readSource("src/components/commands.tsx");

  // The palette opens the sheet and lets it do the archiving.
  assert.match(palette, /<InboxZeroSheet/);
  assert.doesNotMatch(palette, /executeInboxZero/);

  // Every Inbox Zero command routes to that sheet, not to a direct archive.
  for (const mode of [
    "ClearInboxToZero",
    "ArchiveAllReadNotifications",
    "ArchiveReactionNotifications",
  ]) {
    assert.match(palette, new RegExp(`CommandMode\\.${mode}`));
  }
});

// The type is the guarantee: an optional previewVersion is what let a caller
// archive without one. Anything that reintroduces a self-fetched preview here
// puts the instant-archive bug straight back.
test("executing Inbox Zero cannot self-confirm its own preview", () => {
  const hook = require("node:fs").readFileSync(
    path.join(root, "src/hooks/Inbox/useInboxZeroActions.ts"),
    "utf8"
  );

  assert.match(hook, /previewVersion: string/);
  assert.doesNotMatch(hook, /previewVersion\?: string/);
  assert.doesNotMatch(hook, /inbox-zero\/preview/);
});

// The sheet opens on whichever preset the command chose, so "Archive reactions"
// does not silently present the default rules.
test("the confirm sheet opens on the preset its command chose", () => {
  const sheet = require("node:fs").readFileSync(
    path.join(root, "src/components/notifications/InboxZeroSheet.tsx"),
    "utf8"
  );

  assert.match(sheet, /initialRules = DEFAULT_INBOX_ZERO_RULES/);
  assert.match(sheet, /useState<InboxZeroThresholdDays>\(\s*initialRules\.threshold/);
  assert.notEqual(
    INBOX_ZERO_PRESETS.reactions.threshold,
    INBOX_ZERO_PRESETS.allRead.threshold
  );
});

test("the confirmation sheet waits for review and executes the preview shown", async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousNavigator = global.navigator;
  const previousHTMLElement = global.HTMLElement;
  const previousElement = global.Element;
  const previousNode = global.Node;
  const previousGetComputedStyle = global.getComputedStyle;
  const previousFetch = global.fetch;
  const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
  const previousScssLoader = require.extensions[".scss"];
  const previousCssLoader = require.extensions[".css"];
  const React = require("react");
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "https://app.hypertask.ai/inbox" }
  );
  const previewRequests = [];
  const executeCalls = [];
  let resolvePreview;
  let closeCount = 0;
  let reactRoot;

  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    global.HTMLElement = dom.window.HTMLElement;
    global.Element = dom.window.Element;
    global.Node = dom.window.Node;
    global.getComputedStyle = dom.window.getComputedStyle;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    require.extensions[".scss"] = (module, filename) => {
      module._compile("module.exports = {};", filename);
    };
    require.extensions[".css"] = require.extensions[".scss"];
    global.fetch = (url, init) => {
      previewRequests.push({ url, body: JSON.parse(init.body) });
      return new Promise((resolve) => {
        resolvePreview = () =>
          resolve(
            new Response(
              JSON.stringify({
                categoryCounts: {
                  read: 0,
                  reactions: 2,
                  ownActions: 0,
                  superseded: 0,
                  pastReminders: 0,
                },
                totalActive: 3,
                totalToArchive: 2,
                totalLeft: 1,
                previewVersion: "reviewed-preview-v1",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
      });
    };

    require("tsx/cjs");
    const { act } = React;
    const { createRoot } = require("react-dom/client");
    const { InboxZeroSheetContent } = require(
      path.join(root, "src/components/notifications/InboxZeroSheet.tsx")
    );
    reactRoot = createRoot(document.getElementById("root"));

    await act(async () => {
      reactRoot.render(
        React.createElement(InboxZeroSheetContent, {
          executeInboxZero: async (rules, previewVersion) => {
            executeCalls.push({ rules, previewVersion });
          },
          initialRules: INBOX_ZERO_PRESETS.reactions,
          onClose: () => {
            closeCount += 1;
          },
        })
      );
    });
    assert.deepEqual(executeCalls, []);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    assert.equal(previewRequests.length, 1);
    assert.equal(
      previewRequests[0].url,
      "/api/notifications/inbox-zero/preview"
    );
    assert.deepEqual(previewRequests[0].body, INBOX_ZERO_PRESETS.reactions);
    assert.deepEqual(executeCalls, []);
    const waitingButton = document.querySelector("button.btn-primary");
    assert.ok(waitingButton);
    assert.equal(waitingButton.disabled, true);
    assert.ok(resolvePreview);

    await act(async () => {
      resolvePreview();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const confirmButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Archive 2 Inbox items"
    );
    assert.ok(confirmButton);
    assert.equal(confirmButton.disabled, false);

    await act(async () => confirmButton.click());
    assert.deepEqual(executeCalls, [
      {
        rules: INBOX_ZERO_PRESETS.reactions,
        previewVersion: "reviewed-preview-v1",
      },
    ]);
    assert.equal(closeCount, 1);
  } finally {
    if (reactRoot) {
      const { act } = React;
      await act(async () => reactRoot.unmount());
    }
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousNavigator === undefined) delete global.navigator;
    else global.navigator = previousNavigator;
    if (previousHTMLElement === undefined) delete global.HTMLElement;
    else global.HTMLElement = previousHTMLElement;
    if (previousElement === undefined) delete global.Element;
    else global.Element = previousElement;
    if (previousNode === undefined) delete global.Node;
    else global.Node = previousNode;
    if (previousGetComputedStyle === undefined) delete global.getComputedStyle;
    else global.getComputedStyle = previousGetComputedStyle;
    if (previousFetch === undefined) delete global.fetch;
    else global.fetch = previousFetch;
    if (previousActEnvironment === undefined) {
      delete global.IS_REACT_ACT_ENVIRONMENT;
    } else {
      global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
    if (previousScssLoader === undefined) delete require.extensions[".scss"];
    else require.extensions[".scss"] = previousScssLoader;
    if (previousCssLoader === undefined) delete require.extensions[".css"];
    else require.extensions[".css"] = previousCssLoader;
    dom.window.close();
  }
});
