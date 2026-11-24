const test = require("node:test");
const assert = require("node:assert/strict");
const { NextRequest } = require("next/server");
const { configureActor, fixture } = require("./helpers/agent-board-scope.cjs");

const FLAG = "htpr-9393-archived-board-task-list";

function tasksRoute(f, enabled) {
  return f.load("src/lib/mcp/operations/tasks/operation.ts", {
    "@/lib/flags": {
      isFeatureEnabled: async (key) => enabled && key === FLAG,
    },
  }).GET;
}

function ask(query) {
  return new NextRequest(`http://localhost/api/mcp/tasks?${query}`);
}

async function bodyOf(response) {
  return response.json();
}

test("a member can list tasks on an archived board when the fix is on", async () => {
  const f = fixture();
  const archived = f.projects.find((project) => project.id === 4060);
  const hidden = f.projects.find((project) => project.id === 2128);
  archived.status = "Archive";
  hidden.status = "Archive";
  const off = tasksRoute(f, false);
  const on = tasksRoute(f, true);

  const refused = await off(ask("project_id=4060"));
  assert.equal(refused.status, 403);
  assert.equal((await bodyOf(refused)).error, "Project not found or access denied");

  const listed = await on(ask("project_id=4060"));
  assert.equal(listed.status, 200);
  const listedBody = await bodyOf(listed);
  assert.equal(listedBody.success, true);
  assert.deepEqual(listedBody.tasks.map((task) => task.projectId), [4060]);

  const byBoard = await on(ask("board_id=4060"));
  assert.equal(byBoard.status, 200);
  assert.deepEqual((await bodyOf(byBoard)).tasks.map((task) => task.projectId), [4060]);

  const stranger = await on(ask("project_id=2128"));
  assert.equal(stranger.status, 403);
  assert.equal((await bodyOf(stranger)).error, "Project not found or access denied");

  archived.status = "Deleted";
  const deleted = await on(ask("project_id=4060"));
  assert.equal(deleted.status, 403);
  assert.equal((await bodyOf(deleted)).error, "Project not found or access denied");
  archived.status = "Archive";

  const open = await on(ask("project_id=15"));
  assert.equal(open.status, 200);
  assert.deepEqual((await bodyOf(open)).tasks.map((task) => task.projectId), [15]);

  const unnamed = await on(ask("limit=50"));
  assert.equal(unnamed.status, 200);
  assert.deepEqual((await bodyOf(unnamed)).tasks.map((task) => task.projectId), [15]);

  configureActor(f, "human");
  const human = await on(ask("project_id=4060"));
  assert.equal(human.status, 200);
  assert.deepEqual((await bodyOf(human)).tasks.map((task) => task.projectId), [4060]);

  const humanOff = await off(ask("project_id=4060"));
  assert.equal(humanOff.status, 403);
  assert.equal((await bodyOf(humanOff)).error, "Project not found or access denied");

  archived.ownerId = 99;
  archived.members = [];
  const outsider = await on(ask("project_id=4060"));
  assert.equal(outsider.status, 403);
  assert.equal((await bodyOf(outsider)).error, "Project not found or access denied");
});
