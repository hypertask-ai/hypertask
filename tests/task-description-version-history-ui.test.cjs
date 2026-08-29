const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) =>
  fs.readFileSync(path.join(process.cwd(), file), "utf8");

const snapshotSource = read(
  "src/utils/controllers/description/common-description-create.ts",
);
const versionsRoute = read(
  "src/app/api/tasks/[taskId]/description-versions/route.ts",
);
const restoreRoute = read(
  "src/app/api/tasks/[taskId]/description-restore/route.ts",
);
const updateTask = read("src/utils/controllers/tasks/single.ts");
const commands = read("src/components/Modals/commands/HTC/AllCommands.ts");
const modal = read(
  "src/components/Modals/TaskDescriptionHistory/TaskDescriptionHistoryModal.tsx",
);

test("description changes preserve an existing empty description", () => {
  assert.match(snapshotSource, /if \(existing && oldContent !== content\)/);
  assert.match(snapshotSource, /contentHtml: oldContent/);
  assert.match(snapshotSource, /contentText: stripHtml\(oldContent\)/);
  assert.match(snapshotSource, /authorId: actingUserId/);
});

test("version viewing checks task access and returns actor details", () => {
  const access = versionsRoute.indexOf("getProjectWhere(userId, null)");
  const versions = versionsRoute.indexOf("prisma.docVersion.findMany");
  assert.ok(access >= 0 && access < versions);
  assert.match(versionsRoute, /description_: \{ select: \{ content: true \} \}/);
  assert.match(versionsRoute, /current: \{ contentText: stripHtml/);
  assert.match(versionsRoute, /contentText: true/);
  assert.doesNotMatch(versionsRoute, /contentHtml: true/);
  assert.match(versionsRoute, /take: MAX_DESCRIPTION_VERSIONS \+ 1/);
  assert.match(versionsRoute, /hasMore/);
  assert.match(versionsRoute, /actor: \{/);
  assert.match(versionsRoute, /prisma.agent.findMany/);
});

test("restoration is task-scoped and uses the normal description update path", () => {
  const access = restoreRoute.indexOf("getProjectWhere(userId, null)");
  const snapshot = restoreRoute.indexOf("prisma.docVersion.findFirst");
  const update = restoreRoute.indexOf("updateTaskSingle(");
  assert.ok(access >= 0 && access < snapshot && snapshot < update);
  assert.match(restoreRoute, /entityType: 'task_description'/);
  assert.match(restoreRoute, /entityId: taskId/);
  assert.match(restoreRoute, /expectedDescription: task\.description_/);
  assert.match(updateTask, /class TaskDescriptionChangedError/);
  assert.match(updateTask, /options\.expectedDescription/);
  assert.match(updateTask, /status: 409/);
  assert.match(restoreRoute, /broadcastTaskChange\(taskId/);
  assert.match(restoreRoute, /restored_from_version: snapshot.version/);
});

test("Ctrl+K exposes version history only on task detail", () => {
  assert.match(commands, /key: "taskDescriptionVersions"/);
  assert.match(commands, /!taskProps\?\.isKanban/);
  assert.match(commands, /CommandMode\.TaskDescriptionVersions/);
});

test("version history supports comparison and confirmed restoration", () => {
  assert.match(modal, /taskDescriptionVersionsRoute/);
  assert.match(modal, /Current description/);
  assert.match(modal, /selected\.contentText/);
  assert.match(modal, /version_id: selected.id/);
  assert.match(modal, /ConfirmDialog/);
  assert.match(modal, /Restore this version/);
});
