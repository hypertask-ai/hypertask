const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/task-project-fallback-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  resolveTaskProject,
  taskProjectFallbackQueryKey,
} = jiti(path.join(root, "src/lib/keyboard/taskProjectFallback.ts"));

test("keeps the current board instead of resolving the task board", () => {
  const current = { id: 15, name: "Current" };
  const other = { id: 42, name: "Other" };

  assert.equal(resolveTaskProject(current, other.id, [other]), current);
});

test("resolves the task board when there is no current board", () => {
  const projects = [
    { id: 15, name: "One" },
    { id: 42, name: "Two" },
  ];

  assert.equal(resolveTaskProject(null, 42, projects), projects[1]);
  assert.equal(resolveTaskProject(null, 99, projects), null);
  assert.equal(resolveTaskProject(null, null, projects), null);
});

test("scopes fallback cache entries by user and project", () => {
  assert.deepEqual(taskProjectFallbackQueryKey(6, 42), [
    "taskProjectFallback",
    6,
    42,
  ]);
  assert.notDeepEqual(
    taskProjectFallbackQueryKey(6, 42),
    taskProjectFallbackQueryKey(7, 42),
  );
  assert.notDeepEqual(
    taskProjectFallbackQueryKey(6, 42),
    taskProjectFallbackQueryKey(6, 43),
  );
  assert.deepEqual(taskProjectFallbackQueryKey(undefined, undefined), [
    "taskProjectFallback",
    null,
    null,
  ]);
});
