const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

// GET and DELETE on /api/tasks/single are only reachable behind this handler's own
// checks: the edge middleware passes cookieless requests straight through, and the
// GET response carries the task body. Removing either check re-opens a real hole,
// so this exercises the handler rather than asserting on its source.

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/pages/api/tasks/single.ts"),
  "utf8",
);

const javascript = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const MEMBER_PROJECT = 15;
const FOREIGN_PROJECT = 99;
const TASK_ON_MEMBER_BOARD = 1;
const TASK_ON_FOREIGN_BOARD = 2;
const MEMBER_USER_ID = 6;

// The agent this session owns, and one it does not. A body-supplied agentId is
// only worth honouring for an agent the caller controls (HTPR-4810 review).
const OWNED_AGENT = "agent-owned";
const REVOKED_AGENT = "agent-revoked";
const BORROWED_AGENT = "agent-someone-elses";

function loadHandler(session = null, { taskBroadcastGate } = {}) {
  const deleted = [];
  const updated = [];
  const broadcasts = [];
  const stubs = {
    "@/lib/auth/getSessionUser": {
      getSessionUser: async () => session,
    },
    "@/models/model": {},
    "@/utils/controllers/projects/getAllIncludes": {
      taskWriteAccessWhere: (userId, agentId) => ({
        OR: [
          { ownerId: userId },
          { members: { some: { userId, agentId: null } } },
          ...(agentId
            ? [
                {
                  members: {
                    some: {
                      agentId,
                      agent: { userId, revokedAt: null },
                    },
                  },
                },
              ]
            : []),
        ],
      }),
    },
    "@/lib/prisma": {
      __esModule: true,
      default: {
        user: {
          findUnique: async ({ where }) => ({
            displayName: "Member",
            photoURL: "p.png",
            email: `u${where.id}@example.com`,
          }),
        },
        agent: {
          findFirst: async ({ where }) =>
            where.id === OWNED_AGENT &&
            where.userId === MEMBER_USER_ID &&
            where.revokedAt === null
              ? { id: OWNED_AGENT }
              : null,
        },
        project: {
          // Mirrors taskWriteAccessWhere: supplying an agent adds its owned,
          // active membership without removing the human's own access.
          findFirst: async ({ where }) => {
            const hasMemberAccess = where.OR?.some(
              (branch) =>
                branch.members?.some?.userId === MEMBER_USER_ID &&
                branch.members.some.agentId === null,
            );
            const hasOwnedAgentAccess = where.OR?.some(
              (branch) =>
                branch.members?.some?.agentId === OWNED_AGENT &&
                branch.members.some.agent?.userId === MEMBER_USER_ID &&
                branch.members.some.agent?.revokedAt === null,
            );
            if (where.id === MEMBER_PROJECT && hasMemberAccess) {
              return { id: MEMBER_PROJECT };
            }
            if (where.id === MEMBER_PROJECT && hasOwnedAgentAccess) {
              return { id: MEMBER_PROJECT };
            }
            return null;
          },
        },
        task: {
          findUnique: async ({ where }) => {
            if (where.id === TASK_ON_MEMBER_BOARD)
              return { projectId: MEMBER_PROJECT };
            if (where.id === TASK_ON_FOREIGN_BOARD)
              return { projectId: FOREIGN_PROJECT };
            return null;
          },
        },
      },
    },
    "@/utils/controllers/tasks/single": {
      getTaskSingle: async (id) => ({
        status: 200,
        json: {
          id,
          projectId:
            id === TASK_ON_MEMBER_BOARD ? MEMBER_PROJECT : FOREIGN_PROJECT,
          description_: { content: "<p>secret body</p>" },
        },
      }),
      deleteTaskSingle: async (id) => {
        deleted.push(id);
        return { status: 200, json: { id } };
      },
      updateTaskSingle: async (newTask) => {
        updated.push(newTask);
        return { status: 200, json: { id: newTask.id, projectId: MEMBER_PROJECT } };
      },
    },
    "@/lib/realtime/server": {
      broadcastBoardChange: (...args) => broadcasts.push(["board", ...args]),
      broadcastTaskChange: async (...args) => {
        broadcasts.push(["task", ...args]);
        await taskBroadcastGate;
      },
    },
    // The route imports these for PUT relation sync. This auth-focused harness
    // keeps references empty so it can exercise the route without alias loading.
    "@/utils/controllers/comments/extractTaskReferences": {
      extractTaskReferencesFromCommentText: () => [],
    },
    "@/utils/controllers/tasks/addRelatedTasks": {
      addRelatedTasks: async () => undefined,
    },
  };

  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    stubs[request] ?? originalLoad(request, parent, isMain);
  try {
    const mod = { exports: {} };
    new Function("module", "exports", "require", javascript)(
      mod,
      mod.exports,
      (request) => stubs[request] ?? require(request),
    );
    return { handler: mod.exports.default, deleted, updated, broadcasts };
  } finally {
    Module._load = originalLoad;
  }
}

function call(handler, { method, taskId, userId, body }) {
  const req = {
    method,
    query: { id: String(taskId) },
    body: body ?? {},
    headers: {},
    cookies: userId === undefined ? {} : { nookies_user: JSON.stringify({ id: userId }) },
  };
  let status = 0;
  let payload;
  const res = {
    status(code) {
      status = code;
      return res;
    },
    json(body) {
      payload = body;
      return res;
    },
  };
  return handler(req, res).then(() => ({ status, payload }));
}

test("GET refuses to hand a task body to an anonymous caller", async () => {
  const { handler } = loadHandler();
  const { status } = await call(handler, {
    method: "GET",
    taskId: TASK_ON_MEMBER_BOARD,
  });
  assert.equal(status, 401);
});

test("GET refuses a logged-in user who is not on the task's board", async () => {
  const { handler } = loadHandler();
  const { status } = await call(handler, {
    method: "GET",
    taskId: TASK_ON_FOREIGN_BOARD,
    userId: MEMBER_USER_ID,
  });
  assert.equal(status, 403);
});

test("GET returns the task body to a board member", async () => {
  const { handler } = loadHandler();
  const { status, payload } = await call(handler, {
    method: "GET",
    taskId: TASK_ON_MEMBER_BOARD,
    userId: MEMBER_USER_ID,
  });
  assert.equal(status, 200);
  assert.equal(payload.description_.content, "<p>secret body</p>");
});

test("DELETE never runs for an anonymous caller", async () => {
  const { handler, deleted } = loadHandler();
  const { status } = await call(handler, {
    method: "DELETE",
    taskId: TASK_ON_MEMBER_BOARD,
  });
  assert.equal(status, 401);
  assert.deepEqual(deleted, []);
});

test("DELETE never runs for a user outside the task's board", async () => {
  const { handler, deleted } = loadHandler({ userId: MEMBER_USER_ID });
  const { status } = await call(handler, {
    method: "DELETE",
    taskId: TASK_ON_FOREIGN_BOARD,
    userId: MEMBER_USER_ID,
  });
  assert.equal(status, 403);
  assert.deepEqual(deleted, []);
});

test("DELETE runs for a board member", async () => {
  const { handler, deleted } = loadHandler({ userId: MEMBER_USER_ID });
  const { status } = await call(handler, {
    method: "DELETE",
    taskId: TASK_ON_MEMBER_BOARD,
    userId: MEMBER_USER_ID,
  });
  assert.equal(status, 200);
  assert.deepEqual(deleted, [TASK_ON_MEMBER_BOARD]);
});

// PUT is the hot path for board moves, inline edits and agent writes, and it
// used to take the identity cookie without ever checking board membership: any
// logged-in account could edit any task on any board (HTPR-4810).

test("PUT refuses an anonymous caller", async () => {
  const { handler, updated } = loadHandler(null);
  const { status } = await call(handler, {
    method: "PUT",
    taskId: TASK_ON_MEMBER_BOARD,
    body: { newTask: { id: TASK_ON_MEMBER_BOARD, title: "hijacked" } },
  });
  assert.equal(status, 401);
  assert.deepEqual(updated, []);
});

test("PUT refuses a logged-in user who is not on the task's board", async () => {
  const { handler, updated, broadcasts } = loadHandler({ userId: MEMBER_USER_ID });
  const { status } = await call(handler, {
    method: "PUT",
    taskId: TASK_ON_FOREIGN_BOARD,
    body: { newTask: { id: TASK_ON_FOREIGN_BOARD, title: "hijacked" } },
  });
  assert.equal(status, 403);
  assert.deepEqual(updated, []);
  assert.deepEqual(broadcasts, []);
});

test("PUT lets a board member edit and broadcasts only after persistence", async () => {
  const { handler, updated, broadcasts } = loadHandler({
    userId: MEMBER_USER_ID,
  });
  const { status } = await call(handler, {
    method: "PUT",
    taskId: TASK_ON_MEMBER_BOARD,
    body: { newTask: { id: TASK_ON_MEMBER_BOARD, title: "fine" } },
  });
  assert.equal(status, 200);
  assert.equal(updated.length, 1);
  assert.deepEqual(broadcasts.map(([kind]) => kind), ["board", "task"]);
});

test("PUT waits for description realtime delivery before responding", async () => {
  let releaseBroadcast;
  const taskBroadcastGate = new Promise((resolve) => {
    releaseBroadcast = resolve;
  });
  const { handler, broadcasts } = loadHandler(
    { userId: MEMBER_USER_ID },
    { taskBroadcastGate },
  );
  let responded = false;
  const request = call(handler, {
    method: "PUT",
    taskId: TASK_ON_MEMBER_BOARD,
    body: {
      newTask: {
        id: TASK_ON_MEMBER_BOARD,
        description: "<p>updated for everyone</p>",
      },
    },
  }).then((result) => {
    responded = true;
    return result;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(broadcasts.map(([kind]) => kind), ["board", "task"]);
  assert.equal(responded, false);

  releaseBroadcast();
  const { status } = await request;
  assert.equal(status, 200);
});

test("PUT broadcasts task detail changes when status is updated", async () => {
  const { handler, updated, broadcasts } = loadHandler({ userId: MEMBER_USER_ID });
  const { status } = await call(handler, {
    method: "PUT",
    taskId: TASK_ON_MEMBER_BOARD,
    body: {
      newTask: { id: TASK_ON_MEMBER_BOARD, status: "Archive" },
    },
  });
  assert.equal(status, 200);
  assert.equal(updated.length, 1);
  assert.deepEqual(broadcasts.map(([kind]) => kind), ["board", "task"]);
});

test("PUT refuses a move onto a board the caller is not on", async () => {
  const { handler, updated, broadcasts } = loadHandler({ userId: MEMBER_USER_ID });
  const { status } = await call(handler, {
    method: "PUT",
    taskId: TASK_ON_MEMBER_BOARD,
    body: {
      newTask: { id: TASK_ON_MEMBER_BOARD, projectId: FOREIGN_PROJECT },
    },
  });
  assert.equal(status, 403);
  assert.deepEqual(updated, []);
  assert.deepEqual(broadcasts, []);
});

// agentId arrives in the request body, so honouring it without checking who
// owns that agent would reopen the same hole through a side door: agent UUIDs
// are visible to any teammate in an assignee dropdown.
test("PUT refuses an agentId the session does not own", async () => {
  const { handler, updated, broadcasts } = loadHandler({ userId: MEMBER_USER_ID });
  const { status } = await call(handler, {
    method: "PUT",
    taskId: TASK_ON_MEMBER_BOARD,
    body: {
      newTask: { id: TASK_ON_MEMBER_BOARD, title: "borrowed" },
      agentId: BORROWED_AGENT,
    },
  });
  assert.equal(status, 403);
  assert.deepEqual(updated, []);
  assert.deepEqual(broadcasts, []);
});

test("PUT refuses a revoked agent context without persistence or realtime", async () => {
  const { handler, updated, broadcasts } = loadHandler({ userId: MEMBER_USER_ID });
  const { status } = await call(handler, {
    method: "PUT",
    taskId: TASK_ON_MEMBER_BOARD,
    body: {
      newTask: { id: TASK_ON_MEMBER_BOARD, title: "revoked" },
      agentId: REVOKED_AGENT,
    },
  });
  assert.equal(status, 403);
  assert.deepEqual(updated, []);
  assert.deepEqual(broadcasts, []);
});

test("PUT still lets an agent this session owns write to its own board", async () => {
  const { handler, updated } = loadHandler({ userId: MEMBER_USER_ID });
  const { status } = await call(handler, {
    method: "PUT",
    taskId: TASK_ON_MEMBER_BOARD,
    body: {
      newTask: { id: TASK_ON_MEMBER_BOARD, description: "<p>agent wrote this</p>" },
      agentId: OWNED_AGENT,
    },
  });
  assert.equal(status, 200);
  assert.equal(updated.length, 1);
});
