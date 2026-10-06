const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/task-hard-delete-auth-jiti-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);
const { taskWriteAccessWhere } = jiti(
  path.join(root, "src/utils/controllers/projects/getAllIncludes.ts"),
);

function memberMatches(member, where) {
  return Object.entries(where).every(([key, value]) => member[key] === value);
}

function projectMatches(project, where) {
  if (where.ownerId !== undefined && project.ownerId !== where.ownerId) {
    return false;
  }
  if (
    where.members?.some &&
    !project.members.some((member) => memberMatches(member, where.members.some))
  ) {
    return false;
  }
  if (where.OR && !where.OR.some((branch) => projectMatches(project, branch))) {
    return false;
  }
  return true;
}

function loadRoute({ session = null, task = null, deleteOutcome = "success" } = {}) {
  const calls = { taskLookups: [], deletes: [], broadcasts: [] };
  const stubs = {
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/flags/keys": { HTPR_6923_APP_ROUTER_WRITES_FLAG: "htpr-6923-app-router-writes" },
    "@/lib/auth/getSessionUser": {
      getSessionUser: async () => session,
    },
    "@/lib/prisma": {
      __esModule: true,
      default: {
        task: {
          findFirst: async (query) => {
            calls.taskLookups.push(query);
            if (
              task?.id !== query.where.id ||
              task.status !== query.where.status ||
              !projectMatches(task.project, query.where.project)
            ) {
              return null;
            }
            return { projectId: task.projectId };
          },
        },
      },
    },
    "@/lib/realtime/server": {
      broadcastBoardChange: (projectId) => {
        calls.broadcasts.push(projectId);
      },
    },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere },
    "@/utils/controllers/tasks/invokeTaskDelete": {
      permanentlyDeleteTask: async (...args) => {
        calls.deletes.push(args);
        return deleteOutcome;
      },
    },
  };

  return { handler: load("src/pages/api/tasks/deleteTask.ts", stubs).default, calls };
}

function responseRecorder() {
  const result = { status: null, body: null };
  const response = {
    status(status) {
      result.status = status;
      return response;
    },
    json(body) {
      result.body = body;
      return response;
    },
  };
  return { response, result };
}

function deleteRequest() {
  return {
    method: "DELETE",
    query: { taskId: "101" },
    headers: {},
  };
}

test("hard deletion rejects an unauthenticated request before reading or deleting a task", async () => {
  const { handler, calls } = loadRoute();
  const { response, result } = responseRecorder();

  await handler(deleteRequest(), response);

  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { message: "Unauthorized" });
  assert.deepEqual(calls, { taskLookups: [], deletes: [], broadcasts: [] });
});

test("hard deletion rejects a task outside the caller's writable projects", async () => {
  const { handler, calls } = loadRoute({
    session: { userId: 23 },
    task: {
      id: 101,
      status: "Deleted",
      projectId: 99,
      project: { ownerId: 99, members: [] },
    },
  });
  const { response, result } = responseRecorder();

  await handler(deleteRequest(), response);

  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { message: "Task not found or access denied" });
  assert.deepEqual(calls.taskLookups, [
    {
      where: {
        id: 101,
        status: "Deleted",
        project: taskWriteAccessWhere(23),
      },
      select: { projectId: true },
    },
  ]);
  assert.deepEqual(calls.deletes, []);
  assert.deepEqual(calls.broadcasts, []);
});

test("hard deletion passes the authenticated identity after task authorization", async () => {
  const { handler, calls } = loadRoute({
    session: { userId: 23 },
    task: {
      id: 101,
      status: "Deleted",
      projectId: 15,
      project: { ownerId: 23, members: [] },
    },
  });
  const { response, result } = responseRecorder();

  await handler(deleteRequest(), response);

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { message: "Success" });
  assert.deepEqual(calls.deletes, [[101, 23]]);
  assert.deepEqual(calls.broadcasts, [15]);
});
