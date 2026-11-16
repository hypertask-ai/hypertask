const test = require("node:test");
const assert = require("node:assert/strict");
const { NextRequest } = require("next/server");
const { fixture } = require("./helpers/agent-board-scope.cjs");

const FLAG = "htpr-9393-archived-board-task-list";

function tasksRoute(f, enabled) {
  return f.load("src/lib/mcp/operations/tasks/operation.ts", {
    "@/lib/flags": {
      isFeatureEnabled: async (key) => enabled && key === FLAG,
    },
  }).GET;
}

function ask(projectId) {
  return new NextRequest(`http://localhost/api/mcp/tasks?project_id=${projectId}`);
}

test("a member can list tasks on an archived board when the fix is on", async () => {
  const f = fixture();
  const archived = f.projects.find((project) => project.id === 4060);
  const hidden = f.projects.find((project) => project.id === 2128);
  archived.status = "Archive";
  hidden.status = "Archive";
  const off = tasksRoute(f, false);
  const on = tasksRoute(f, true);

  const refused = await off(ask(4060));
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, "Project not found or access denied");

  const listed = await on(ask(4060));
  assert.equal(listed.status, 200);
  const body = await listed.json();
  assert.equal(body.success, true);
  assert.deepEqual(body.tasks.map((task) => task.projectId), [4060]);

  const stranger = await on(ask(2128));
  assert.equal(stranger.status, 403);
  assert.equal((await stranger.json()).error, "Project not found or access denied");

  archived.status = "Deleted";
  const deleted = await on(ask(4060));
  assert.equal(deleted.status, 403);

  const open = await on(ask(15));
  assert.equal(open.status, 200);
  assert.deepEqual((await open.json()).tasks.map((task) => task.projectId), [15]);
});
