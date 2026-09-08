// HTPR-6279 — `hypertask tasks get` must report `assigneeCount` like
// `tasks list` does. The single-task mapper builds the visible assignee list
// and its count from the same filtered array, so a hidden agent assignee must
// not be counted either.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/mcp-task-get-assignee-count.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { mapTaskToMcpGetResponse } = jiti(
  path.join(root, "src/lib/mcp/tasks/mappers.ts")
);

const baseTask = {
  id: 1,
  uniqueIndex: 6279,
  projectId: 15,
  title: "t",
  description: "",
  project: { title: "Hypertask Product", staleWarnDays: null, staleHotDays: null },
  createdAt: new Date("2026-09-08T00:00:00Z"),
  _count: { comments: 0 },
};

test("mapTaskToMcpGetResponse reports assigneeCount matching the assignee list", () => {
  const task = {
    ...baseTask,
    assignees: [
      { user: { id: 6, email: "v@x.io", displayName: "Valentin Yeo" } },
      { user: { id: 7, email: "a@x.io", displayName: null } },
    ],
  };
  const out = mapTaskToMcpGetResponse(task, 6);
  assert.equal(out.assignees.length, 2);
  assert.equal(out.assigneeCount, 2);
});

test("assigneeCount counts only the assignees the response actually lists", () => {
  // An agent assignee the caller cannot see is filtered out of `assignees`;
  // the count must not diverge from the list it is a count of.
  const task = {
    ...baseTask,
    assignees: [
      { user: { id: 6, email: "v@x.io", displayName: "Valentin Yeo" } },
      {
        user: { id: 6, email: "v@x.io", displayName: "Valentin Yeo" },
        agent: { id: "not-visible", userId: 999, visibility: "PRIVATE", members: [], displayName: "Ghost" },
      },
    ],
  };
  const out = mapTaskToMcpGetResponse(task, 6);
  assert.equal(out.assignees.length, 1);
  assert.equal(out.assigneeCount, 1);
});
