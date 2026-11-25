const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const FOREIGN_BOARD = 15;
const SOURCE_TASK = { id: 150, projectId: 9 };

class NextResponse {
  static json(body, init) {
    return new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }
}

function loadMove({
  agentId = "agent-a",
  onBoard = false,
  membershipStatus = "Accepted",
  guidance = false,
  projectExists = true,
  projectStatus = "Normal",
  accessError = null,
  ownerCanRequest = true,
  boardTeamId = "team-a",
  teamScope = null,
  requesterSeesBoard = true,
} = {}) {
  const calls = { moved: [], flags: [], access: 0, boardAccess: [] };
  const membership = onBoard
    ? { projectId: FOREIGN_BOARD, agentId: "agent-a", status: membershipStatus, revokedAt: null }
    : null;
  const boardMatches = (where = {}) => {
    if (typeof where.id === "number" && where.id !== FOREIGN_BOARD) return false;
    if (Array.isArray(where.id?.in) && !where.id.in.includes(FOREIGN_BOARD)) return false;
    if (Array.isArray(where.status?.in) && !where.status.in.includes(projectStatus)) return false;
    if (where.AND && !where.AND.every(boardMatches)) return false;
    if (where.OR && !where.OR.some(boardMatches)) return false;
    if (where.members?.some) {
      const some = where.members.some;
      return Boolean(
        membership &&
        membership.revokedAt == null &&
        (some.agentId == null || some.agentId === membership.agentId),
      );
    }
    return true;
  };
  const route = load("src/lib/mcp/operations/tasks/move/operation.ts", {
    "next/server": { NextResponse, NextRequest: class {} },
    "@/lib/planLimits": {
      isPlanLimitReachedError: () => false,
      planLimitResponse: () => ({ status: 402, body: { success: false } }),
    },
    "@/lib/mcp/agents/readRoleGuard": { requireAgentWriteRole: async () => null },
    "@/lib/mcp/tasks/resolveTask": { taskIdentifierErrorResponse: () => null },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (fn) => fn,
      validateMcpRouteAuth: async () => ({ user: { id: 6 }, agentId, teamScope }),
      checkMcpRouteRateLimit: async () => null,
      mcpRouteUnauthorizedResponse: async () => Response.json({ success: false }, { status: 401 }),
      withMcpRouteMutationLease: async (_db, _actor, run) => run(),
    },
    "@/lib/mcp/agents": { getMcpSessionAgentSummary: async () => null },
    "@/lib/prisma": {
      default: {
        task: {
          findFirst: async () => SOURCE_TASK,
          findUnique: async () => ({ id: 150, projectId: FOREIGN_BOARD, title: "On the target board" }),
        },
        user: {
          findUnique: async () => ({ id: 6, email: "owner@example.invalid", displayName: "Owner", photoURL: null }),
        },
        project: {
          findFirst: async ({ where } = {}) => {
            if (!projectExists || !boardMatches(where)) return null;
            return { id: FOREIGN_BOARD, status: projectStatus };
          },
        },
        member: {
          findFirst: async ({ where } = {}) => {
            if (!membership) return null;
            if (where.projectId !== membership.projectId || where.agentId !== membership.agentId) return null;
            if (where.status != null && where.status !== membership.status) return null;
            if (where.agent?.revokedAt === null && membership.revokedAt != null) return null;
            return { id: 1 };
          },
        },
      },
    },
    "@/lib/mcp/tasks/mappers": {
      mapTaskToDetail: (task) => ({ id: task.id, projectId: task.projectId, title: task.title }),
      taskDetailInclude: () => ({}),
    },
    "@/utils/controllers/tasks/moveToDifferentBoard": {
      moveTaskToDifferentBoard: async (params) => {
        calls.moved.push({
          taskId: params.taskId,
          targetProjectId: params.targetProjectId,
          agentId: params.agentId,
        });
        return { success: true, task: { id: params.taskId, projectId: params.targetProjectId } };
      },
    },
    "@/utils/controllers/projects/getAllIncludes": {
      getProjectWhere: () => ({}),
      projectContentAccessWhere: () => (requesterSeesBoard ? {} : { id: { in: [] } }),
    },
    "@/lib/mcp/tasks/services": {
      validateProjectAccess: async () => {
        calls.access += 1;
        return accessError
          ? { project: null, error: accessError }
          : { project: { id: FOREIGN_BOARD }, error: null };
      },
      getSectionForTask: async () => ({ section: { id: 5 }, error: null }),
    },
    "@/lib/realtime/server": { broadcastBoardChange: () => {} },
    "@/utils/controllers/agents/boardMembers": {
      getAccessibleAgentBoard: async (projectId, userId, actingAgentId, scope) => {
        calls.boardAccess.push({ projectId, userId, actingAgentId, teamScope: scope ?? null });
        if (!ownerCanRequest || projectStatus !== "Normal") return null;
        if (scope && scope.teamId !== boardTeamId) return null;
        return { id: projectId, name: "Foreign", ownerId: userId, teamId: boardTeamId, title: "Foreign" };
      },
    },
    "@/lib/flags": {
      isFeatureEnabled: async (key, userId) => {
        calls.flags.push({ key, userId });
        return guidance;
      },
    },
  });
  return { POST: route.POST, calls };
}

async function move(options) {
  const { POST, calls } = loadMove(options);
  const response = await POST({
    json: async () => ({ task_id: SOURCE_TASK.id, target_project_id: FOREIGN_BOARD }),
    headers: { get: () => null },
    url: "https://app.hypertask.ai/api/mcp/tasks/move",
    method: "POST",
  });
  return { status: response.status, body: await response.json(), calls };
}

test("an agent that is not a member of the target board is refused before the task moves", async () => {
  const { status, body, calls } = await move();
  assert.equal(status, 403);
  assert.equal(body.success, false);
  assert.equal(body.code, "forbidden");
  assert.equal(body.field, "target_project_id");
  assert.equal(body.message, "This agent is not a member of this board. Ask the board owner to add it.");
  assert.deepEqual(calls.moved, []);
  assert.deepEqual(calls.flags, [{ key: "htpr-8471-board-refusal-next-step", userId: 6 }]);
});

test("the refusal names the board access request when the owner can request that board", async () => {
  const teamScope = { teamId: "team-a", accessBinding: "bind" };
  const { status, body, calls } = await move({ guidance: true, teamScope });
  assert.equal(status, 403);
  assert.equal(
    body.message,
    "This agent is not a member of this board. Request access with the hypertask_request_board_access tool (project_id 15); your owner approves it in Inbox → Decisions.",
  );
  assert.deepEqual(calls.boardAccess, [{ projectId: 15, userId: 6, actingAgentId: null, teamScope }]);
  assert.deepEqual(calls.moved, []);
});

test("an inaccessible board is still refused, without the access-request tool", async () => {
  const { status, body, calls } = await move({ guidance: true, ownerCanRequest: false });
  assert.equal(status, 403);
  assert.equal(body.message, "This agent is not a member of this board. Ask the board owner to add it.");
  assert.deepEqual(calls.boardAccess, [{ projectId: 15, userId: 6, actingAgentId: null, teamScope: null }]);
  assert.deepEqual(calls.flags, []);
  assert.deepEqual(calls.moved, []);
});

test("a board outside the agent team is still refused, without the access-request tool", async () => {
  const teamScope = { teamId: "team-a", accessBinding: "bind" };
  const { status, body, calls } = await move({ guidance: true, teamScope, boardTeamId: "team-b" });
  assert.equal(status, 403);
  assert.equal(body.message, "This agent is not a member of this board. Ask the board owner to add it.");
  assert.deepEqual(calls.boardAccess, [{ projectId: 15, userId: 6, actingAgentId: null, teamScope }]);
  assert.deepEqual(calls.flags, []);
  assert.deepEqual(calls.moved, []);
});

test("a board the requester cannot see is refused without the membership message", async () => {
  const denied = { status: 403, message: "User does not have permission to create tasks in this project" };
  const { status, body, calls } = await move({ requesterSeesBoard: false, guidance: true, accessError: denied });
  assert.equal(status, 403);
  assert.equal(body.error, denied.message);
  assert.equal(calls.access, 1);
  assert.deepEqual(calls.boardAccess, []);
  assert.deepEqual(calls.flags, []);
  assert.deepEqual(calls.moved, []);
});

test("an invited membership still blocks a move onto a board the requester cannot see", async () => {
  const { status, body, calls } = await move({
    requesterSeesBoard: false,
    onBoard: true,
    membershipStatus: "Invited",
    ownerCanRequest: false,
  });
  assert.equal(status, 403);
  assert.equal(body.message, "This agent is not a member of this board. Ask the board owner to add it.");
  assert.equal(calls.access, 0);
  assert.deepEqual(calls.flags, []);
  assert.deepEqual(calls.moved, []);
});

test("the agent token, not the person token, is refused with not a member on an archived board", async () => {
  const archived = { status: 400, message: 'Board "Old" is archived, so it cannot take new tickets.' };
  const { status, body, calls } = await move({ accessError: archived });
  assert.equal(status, 403);
  assert.equal(body.message, "This agent is not a member of this board. Ask the board owner to add it.");
  assert.equal(calls.access, 0);
  assert.deepEqual(calls.moved, []);
});

test("an invited membership does not let the agent move onto that board", async () => {
  const { status, body, calls } = await move({ onBoard: true, membershipStatus: "Invited" });
  assert.equal(status, 403);
  assert.equal(body.message, "This agent is not a member of this board. Ask the board owner to add it.");
  assert.equal(calls.access, 0);
  assert.deepEqual(calls.moved, []);
});

test("a deleted board stays not found", async () => {
  const missing = { status: 404, message: "Project with ID 15 not found" };
  const { status, body, calls } = await move({ projectStatus: "Deleted", accessError: missing });
  assert.equal(status, 404);
  assert.equal(body.error, "Project with ID 15 not found");
  assert.equal(calls.access, 1);
  assert.deepEqual(calls.moved, []);
});

test("a target board that does not exist stays not found", async () => {
  const missing = { status: 404, message: "Project with ID 15 not found" };
  const { status, body, calls } = await move({ projectExists: false, accessError: missing });
  assert.equal(status, 404);
  assert.equal(body.error, "Project with ID 15 not found");
  assert.equal(calls.access, 1);
  assert.deepEqual(calls.moved, []);
});

test("still allowed: an agent that is a member of an archived board still gets the archived refusal", async () => {
  const archived = { status: 400, message: 'Board "Old" is archived, so it cannot take new tickets.' };
  const { status, body, calls } = await move({ onBoard: true, accessError: archived });
  assert.equal(status, 400);
  assert.equal(body.error, 'Board "Old" is archived, so it cannot take new tickets.');
  assert.equal(calls.access, 1);
  assert.deepEqual(calls.moved, []);
});

test("still allowed: an agent that is a member of the target board moves the task there", async () => {
  const { status, body, calls } = await move({ onBoard: true });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.message, "Task moved successfully");
  assert.deepEqual(body.task, { id: 150, projectId: 15, title: "On the target board" });
  assert.deepEqual(calls.moved, [{ taskId: 150, targetProjectId: 15, agentId: "agent-a" }]);
  assert.equal(calls.flags.some((flag) => flag.key === "htpr-8471-board-refusal-next-step"), false);
});

test("still allowed: a person without an agent moves onto the board with no agent membership check", async () => {
  const { status, body, calls } = await move({ agentId: null });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.task, { id: 150, projectId: 15, title: "On the target board" });
  assert.deepEqual(calls.moved, [{ taskId: 150, targetProjectId: 15, agentId: null }]);
  assert.equal(calls.flags.some((flag) => flag.key === "htpr-8471-board-refusal-next-step"), false);
});
