const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/task-detail-staleness-realtime.test.cjs"), {
  interopDefault: true,
});

const { COMMENT_EVENT, TASK_EVENT } = jiti(
  path.join(root, "src/lib/realtime/shared.ts")
);
const {
  mergeRealtimeTaskDetail,
  shouldApplyRealtimeTaskDetail,
  shouldPreserveTaskEditorContent,
  shouldRefetchTaskDetail,
  shouldSyncTaskDetailContent,
} = jiti(path.join(root, "src/lib/realtime/taskDetailRefresh.ts"));

test("comment events refresh task detail so last-comment staleness updates live", () => {
  assert.equal(
    shouldRefetchTaskDetail({
      event: COMMENT_EVENT,
      currentUserId: 6,
      originUserId: 6,
    }),
    true
  );
});

test("same-user task events refresh task detail so column staleness updates across tabs", () => {
  assert.equal(
    shouldRefetchTaskDetail({
      event: TASK_EVENT,
      currentUserId: 6,
      originUserId: 6,
    }),
    true
  );
});

test("realtime metadata refreshes preserve unsaved description and attachment drafts", () => {
  assert.equal(shouldSyncTaskDetailContent(COMMENT_EVENT, false), false);
  assert.equal(shouldSyncTaskDetailContent(COMMENT_EVENT, true), false);
  assert.equal(shouldSyncTaskDetailContent(TASK_EVENT, true), false);
  assert.equal(shouldSyncTaskDetailContent(TASK_EVENT, false), true);
});

test("an idle description upload does not keep editor preservation active", () => {
  const base = {
    hasDraft: false,
    hasDraftInit: false,
    editMode: undefined,
  };

  assert.equal(
    shouldPreserveTaskEditorContent({
      ...base,
      uploadingDescription: undefined,
    }),
    false
  );
  assert.equal(
    shouldPreserveTaskEditorContent({
      ...base,
      uploadingDescription: false,
    }),
    false
  );
});

test("an active description upload preserves editor content", () => {
  assert.equal(
    shouldPreserveTaskEditorContent({
      hasDraft: false,
      hasDraftInit: false,
      uploadingDescription: { id: "description" },
    }),
    true
  );
});

test("a metadata refresh merges remote task fields without replacing editor content", () => {
  const currentTask = {
    id: 4833,
    projectId: 15,
    uniqueIndex: 4833,
    sectionChangedAt: "2026-08-01T00:00:00.000Z",
    lastCommentAt: "2026-08-02T00:00:00.000Z",
    title: "Old title",
    priority: { id: 1, name: "Low" },
    description: "unsaved description",
    descriptionJson: { type: "doc", content: [{ type: "unsaved" }] },
    description_: {
      content: "unsaved description",
      attachments: [{ id: 1, name: "draft.png" }],
    },
  };
  const fetchedTask = {
    ...currentTask,
    sectionChangedAt: "2026-08-18T05:00:00.000Z",
    lastCommentAt: "2026-08-18T05:01:00.000Z",
    title: "New title",
    priority: { id: 2, name: "High" },
    description: "server description",
    descriptionJson: { type: "doc", content: [{ type: "server" }] },
    description_: {
      content: "server description",
      attachments: [],
    },
  };

  const merged = mergeRealtimeTaskDetail(currentTask, fetchedTask, false);

  assert.equal(merged.sectionChangedAt, fetchedTask.sectionChangedAt);
  assert.equal(merged.lastCommentAt, fetchedTask.lastCommentAt);
  assert.equal(merged.title, fetchedTask.title);
  assert.equal(merged.priority, fetchedTask.priority);
  assert.equal(merged.description, currentTask.description);
  assert.equal(merged.descriptionJson, currentTask.descriptionJson);
  assert.equal(merged.description_, currentTask.description_);
});

test("a clean task editor accepts the complete realtime task payload", () => {
  const currentTask = {
    id: 4833,
    projectId: 15,
    uniqueIndex: 4833,
    description_: { content: "old", attachments: [] },
  };
  const fetchedTask = {
    ...currentTask,
    description_: { content: "new", attachments: [] },
  };

  assert.equal(
    mergeRealtimeTaskDetail(currentTask, fetchedTask, true),
    fetchedTask
  );
});

test("a navigation transition never merges the previous task's editor content", () => {
  const previousTask = {
    id: 4832,
    projectId: 15,
    uniqueIndex: 4832,
    description_: { content: "task A draft", attachments: [{ id: 1 }] },
  };
  const fetchedTask = {
    id: 4833,
    projectId: 15,
    uniqueIndex: 4833,
    description_: { content: "task B", attachments: [] },
  };

  assert.equal(
    mergeRealtimeTaskDetail(previousTask, fetchedTask, false),
    fetchedTask
  );
});

test("unrelated realtime events do not trigger a task-detail refresh", () => {
  assert.equal(
    shouldRefetchTaskDetail({
      event: "timer:changed",
      currentUserId: 6,
      originUserId: 6,
    }),
    false
  );
});

const fetchedTask = {
  id: 4833,
  projectId: 15,
  uniqueIndex: 4833,
};

test("a current realtime fetch can update the open task", () => {
  assert.equal(
    shouldApplyRealtimeTaskDetail({
      cancelled: false,
      expectedTaskId: 4833,
      expectedProjectId: 15,
      expectedUniqueIndex: 4833,
      task: fetchedTask,
    }),
    true
  );
});

test("an in-flight realtime fetch cannot overwrite a task opened during navigation", () => {
  assert.equal(
    shouldApplyRealtimeTaskDetail({
      cancelled: true,
      expectedTaskId: 4833,
      expectedProjectId: 15,
      expectedUniqueIndex: 4833,
      task: fetchedTask,
    }),
    false
  );
  assert.equal(
    shouldApplyRealtimeTaskDetail({
      cancelled: false,
      expectedTaskId: 4834,
      expectedProjectId: 15,
      expectedUniqueIndex: 4834,
      task: fetchedTask,
    }),
    false
  );
});
