const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/inbox-reaction-sibling-removal.test.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);
const { buildInboxQueryCache } = jiti(
  path.join(root, "src/utils/helperFunctions/helperFunctions.ts"),
);
const { createInboxRemovalMutation, applyInboxReadModelMutation } = jiti(
  path.join(root, "src/lib/inboxSync/mutation.ts"),
);

// HTPR-5745: removing one reaction row from the REACTIONS split left sibling
// rows (other reactors, same task) painted until refresh, even though the
// server had already archived them. Root cause: markAsDone and
// (un)archiveBulk both archive every OTHER notification sharing the removed
// row's taskId (HTPR-5640 sibling cleanup), but the client's optimistic
// removal only matched the clicked row's own id -- it never mirrored the
// server's taskId-scoped sibling cleanup.
const reactionRow = (over) => ({
  id: over.id,
  taskId: 900,
  projectId: 15,
  type: "Reacted",
  activeNotificationTypes: ["Reacted"],
  status: "Normal",
  seen: false,
  userId: 6,
  createdAt: "2026-08-01T00:00:00.000Z",
  project: { title: "Product", name: "product" },
  task: { id: 900, projectId: 15, title: "Ship it", status: "Normal" },
  ...over,
});

test("removing one reactor's row also removes sibling reaction rows for the same task", () => {
  const alice = reactionRow({ id: 101, fromUserId: 1 });
  const bob = reactionRow({ id: 102, fromUserId: 2 });
  const payload = buildInboxQueryCache([alice, bob]);

  // The UI hands removeElementFromState the exact row object it rendered --
  // here, the row for Alice's reaction.
  const clickedRow = payload.notifications.find((n) => n.id === 101);
  const mutation = createInboxRemovalMutation([clickedRow]);
  const result = applyInboxReadModelMutation(payload, mutation);
  const rebuilt = buildInboxQueryCache(
    result.notifications,
    result.splitsNoImportant,
    result.showImportantSplit,
  );

  assert.deepEqual(
    result.notifications.map((n) => n.id),
    [],
    "both reactors' rows should be gone from the flat notifications list",
  );
  const reactionsTab = rebuilt.structuredData.tabs.find(
    (tab) => tab.project === "Reactions",
  );
  assert.equal(
    reactionsTab,
    undefined,
    "the Reactions split should have no leftover row for this task",
  );
});

test("removing a real row for a task leaves that task's blocked-by-you synthetic row alone", () => {
  // Synthetic "waiting on you" rows (id "-<taskId>") are recomputed fresh from
  // the task on every fetch, not archived server-side. A taskId-scoped
  // removal must not strip them optimistically -- the next refetch would just
  // bring the row back (a "late response restoring old content" per the
  // speed-optimization contract).
  const real = reactionRow({ id: 301, taskId: 900 });
  const synthetic = reactionRow({
    id: "-900",
    taskId: 900,
    waitingOnSynthetic: true,
    type: "WaitingOnYou",
    activeNotificationTypes: ["WaitingOnYou"],
  });
  const payload = buildInboxQueryCache([real, synthetic]);

  const mutation = createInboxRemovalMutation([real]);
  const result = applyInboxReadModelMutation(payload, mutation);

  assert.deepEqual(
    result.notifications.map((n) => n.id),
    ["-900"],
    "the synthetic row should survive removal of the real sibling",
  );
});

test("removing a task-less notification (no taskId) does not touch unrelated rows", () => {
  const invited = reactionRow({
    id: 201,
    taskId: undefined,
    task: undefined,
    type: "Invited",
    activeNotificationTypes: ["Invited"],
  });
  const unrelated = reactionRow({ id: 202, taskId: 501 });
  const payload = buildInboxQueryCache([invited, unrelated]);

  const mutation = createInboxRemovalMutation([invited]);
  const result = applyInboxReadModelMutation(payload, mutation);

  assert.deepEqual(
    result.notifications.map((n) => n.id),
    [202],
    "only the task-less notification should be removed",
  );
});
