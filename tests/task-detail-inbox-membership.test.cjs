const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.join(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});

const { taskDetailInclude } = jiti(
  path.join(root, "src/utils/controllers/taskDetail/load.ts"),
);
const { getTaskCountSelect, getTaskNotificationsInclude } = jiti(
  path.join(root, "src/utils/controllers/projects/getAllIncludes.ts"),
);
const { visibleUserInboxWhere } = jiti(
  path.join(
    root,
    "src/utils/controllers/notifications/visibleInboxScope.ts",
  ),
);

const userId = 6;
const expectedWhere = visibleUserInboxWhere(userId);

test("task detail notification count matches visible inbox where", () => {
  const include = taskDetailInclude(userId, 15);
  assert.deepEqual(include._count.select.notifications.where, expectedWhere);
  assert.deepEqual(include.notifications.where, expectedWhere);
});

test("kanban count where matches visible inbox", () => {
  const count = getTaskCountSelect(userId);
  assert.deepEqual(count.select.notifications.where, expectedWhere);
  const notifications = getTaskNotificationsInclude(userId);
  assert.deepEqual(notifications.notifications.where, expectedWhere);
});
