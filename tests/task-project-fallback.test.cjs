const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/task-project-fallback-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { taskProjectFallbackQueryKey } = jiti(
  path.join(root, "src/lib/keyboard/taskProjectFallback.ts"),
);

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
