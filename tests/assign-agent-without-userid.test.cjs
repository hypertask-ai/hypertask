// HTPR-5090. Pressing A then Enter on an already-assigned agent did nothing.
//
// The board payload selects only { id, displayName, photoURL } for an
// assignee's agent, so the assignee modal has no userId to send when the agent
// is already on the task. /api/assignees/assign required userId and answered
// 400, the optimistic toggle rolled back, and the chip stayed put.
//
// Assigning worked because an UNASSIGNED agent comes from boardAgents, which is
// the full row and does carry userId. That asymmetry is the whole bug.
//
// HTPR-5381: this used to re-implement the guard in the test file, which could
// pass while the route said something else. It now calls the real route handler
// and also pins that a denied call performs no assignment.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const owner = { id: 6, email: "owner@example.test", displayName: "Owner" };
const agentId = "ca30964f-b1a9-4164-84b7-39e91319a1ec";

// Board 15 is the caller's; board 99 belongs to someone else. Which of the two
// the route may see is decided by running its own project predicate against
// these rows, so neither the fixture nor a restated copy of the rule decides it.
const ownedTask = { id: 25995, projectId: 15 };
const foreignTask = { id: 40001, projectId: 40 };
const projects = [
  { id: ownedTask.projectId, teamId: "team-1", ownerId: owner.id, members: [] },
  { id: foreignTask.projectId, teamId: "team-2", ownerId: 7, members: [] },
];

// Just enough of Prisma's filter language to evaluate getProjectWhere: the
// operators it actually emits, and nothing else. An unknown operator throws
// rather than being quietly treated as a match.
function projectMatches(project, where) {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return condition.some((c) => projectMatches(project, c));
    if (key === "teamId") {
      assert.deepEqual(condition, { not: null });
      return project.teamId !== null;
    }
    if (key === "ownerId") return project.ownerId === condition;
    if (key === "members") {
      return project.members.some((member) =>
        Object.entries(condition.some).every(([f, v]) => member[f] === v)
      );
    }
    throw new Error(`unsupported project filter: ${key}`);
  });
}

const state = { session: { userId: owner.id } };
const calls = { assign: [], broadcasts: [] };

stubModule("src/lib/auth/getSessionUser.ts", {
  getSessionUser: async () => state.session,
});

stubModule("src/lib/prisma.ts", {
  default: {
    user: { findUnique: async () => ({ ...owner, photoURL: null }) },
    // HTPR-5381: honour the real `where` instead of answering from a flag. If
    // the route ever drops `project: getProjectWhere(callerId)`, or scopes it
    // to somebody else, this stub stops matching and the foreign-board test
    // fails, which is the whole point of the guard.
    task: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where.project, getProjectWhere(state.session.userId));
        const task = [ownedTask, foreignTask].find(
          (candidate) => candidate.id === where.id
        );
        if (!task) return null;
        const project = projects.find((row) => row.id === task.projectId);
        return projectMatches(project, where.project)
          ? { projectId: task.projectId }
          : null;
      },
    },
  },
});

stubModule("src/lib/realtime/server.ts", {
  broadcastBoardChange: async (projectId) => {
    calls.broadcasts.push(projectId);
  },
});

stubModule("src/utils/controllers/assignees/assign.ts", {
  default: async (currentUser, userId, taskId, agent, _unused, options) => {
    calls.assign.push({ userId, taskId, agentId: agent, options });
    return { status: 200, json: { message: "Success" } };
  },
});

const jiti = require("jiti")(path.join(root, "tests/assign-agent-without-userid.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});

const { getProjectWhere } = jiti(
  path.join(root, "src/utils/controllers/projects/getAllIncludes.ts")
);

const route = jiti(path.join(root, "src/pages/api/assignees/assign.ts"));
// jiti hands back the module namespace here, not the callable default.
const handler = typeof route === "function" ? route : route.default;

function mockResponse() {
  const result = { statusCode: null, body: null };
  const res = {
    status(code) {
      result.statusCode = code;
      return res;
    },
    json(payload) {
      result.body = payload;
      return res;
    },
  };
  return { res, result };
}

async function post(body, { method = "POST" } = {}) {
  calls.assign.length = 0;
  calls.broadcasts.length = 0;
  const { res, result } = mockResponse();
  await handler({ method, body, headers: {} }, res);
  return result;
}

// What AssigneesContainer builds for an agent already on the task: the board
// payload's agent select, with no userId.
const assignedAgentFromBoardPayload = {
  id: agentId,
  displayName: "HT Desktop Developer",
  photoURL: null,
};

// What useAssignTaskUser posts for it.
const bodyFor = (agentOrUser, taskId) =>
  typeof agentOrUser.id === "string"
    ? { agentId: agentOrUser.id, userId: agentOrUser.userId, taskId }
    : { userId: agentOrUser.id, agentId: undefined, taskId };

test.beforeEach(() => {
  state.session = { userId: owner.id };
});

test("removing an already-assigned agent is accepted without a userId", async () => {
  const body = bodyFor(assignedAgentFromBoardPayload, 25995);
  assert.equal(body.userId, undefined, "the payload really has no userId");

  const result = await post(body);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls.assign, [
    { userId: undefined, taskId: 25995, agentId, options: undefined },
  ]);
  assert.deepEqual(calls.broadcasts, [15]);
});

test("an agent carrying a userId still works", async () => {
  const fromBoardAgents = { ...assignedAgentFromBoardPayload, userId: 1234 };

  const result = await post(bodyFor(fromBoardAgents, 25995));
  assert.equal(result.statusCode, 200);
  assert.equal(calls.assign[0].agentId, agentId);
});

test("a human assignee is assigned by userId", async () => {
  const result = await post(bodyFor({ id: 6 }, 25995));
  assert.equal(result.statusCode, 200);
  assert.equal(calls.assign[0].userId, 6);
});

test("a request naming no assignee is rejected without assigning", async () => {
  const result = await post({ taskId: 25995 });
  assert.equal(result.statusCode, 400);
  assert.deepEqual(calls.assign, []);
});

test("a request with no task is rejected without assigning", async () => {
  const result = await post(bodyFor(assignedAgentFromBoardPayload, undefined));
  assert.equal(result.statusCode, 400);
  assert.deepEqual(calls.assign, []);
});

test("an unknown assignee intent is rejected without assigning", async () => {
  const result = await post({ ...bodyFor(assignedAgentFromBoardPayload, 25995), intent: "delete" });
  assert.equal(result.statusCode, 400);
  assert.deepEqual(calls.assign, []);
});

test("a known intent is forwarded to the assignee controller", async () => {
  const result = await post({
    ...bodyFor(assignedAgentFromBoardPayload, 25995),
    intent: "unassign",
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls.assign[0].options, { intent: "unassign" });
});

test("an unauthenticated caller cannot assign an agent", async () => {
  state.session = null;

  const result = await post(bodyFor(assignedAgentFromBoardPayload, 25995));
  assert.equal(result.statusCode, 401);
  assert.deepEqual(calls.assign, []);
  assert.deepEqual(calls.broadcasts, []);
});

test("a task outside the caller's boards is not assignable", async () => {
  const result = await post(bodyFor(assignedAgentFromBoardPayload, foreignTask.id));
  assert.equal(result.statusCode, 404);
  assert.deepEqual(calls.assign, []);
  assert.deepEqual(calls.broadcasts, []);
});

test("only POST reaches the assignee controller", async () => {
  const result = await post(bodyFor(assignedAgentFromBoardPayload, 25995), {
    method: "GET",
  });
  assert.equal(result.statusCode, 405);
  assert.deepEqual(calls.assign, []);
});
