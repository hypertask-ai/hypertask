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

function loadMove({ agentId = "agent-a", onBoard = false, guidance = false } = {}) {
  const calls = { moved: [], flags: [] };
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
      validateMcpRouteAuth: async () => ({ user: { id: 6 }, agentId }),
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
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/lib/mcp/tasks/services": {
      validateProjectAccess: async () => ({ project: { id: FOREIGN_BOARD }, error: null }),
      getSectionForTask: async () => ({ section: { id: 5 }, error: null }),
    },
    "@/lib/realtime/server": { broadcastBoardChange: () => {} },
    "@/utils/controllers/agents/boardMembers": {
      isAgentOnBoard: async (projectId, id) => onBoard && projectId === FOREIGN_BOARD && id === "agent-a",
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

test("the refusal names the board access request when that guidance is on", async () => {
  const { status, body, calls } = await move({ guidance: true });
  assert.equal(status, 403);
  assert.equal(
    body.message,
    "This agent is not a member of this board. Request access with the hypertask_request_board_access tool (project_id 15); your owner approves it in Inbox → Decisions.",
  );
  assert.deepEqual(calls.moved, []);
});

test("still allowed: an agent that is a member of the target board moves the task there", async () => {
  const { status, body, calls } = await move({ onBoard: true });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.message, "Task moved successfully");
  assert.deepEqual(body.task, { id: 150, projectId: 15, title: "On the target board" });
  assert.deepEqual(calls.moved, [{ taskId: 150, targetProjectId: 15, agentId: "agent-a" }]);
  assert.deepEqual(calls.flags, []);
});

test("still allowed: a person without an agent moves onto the board with no agent membership check", async () => {
  const { status, body, calls } = await move({ agentId: null });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.task, { id: 150, projectId: 15, title: "On the target board" });
  assert.deepEqual(calls.moved, [{ taskId: 150, targetProjectId: 15, agentId: null }]);
  assert.deepEqual(calls.flags, []);
});
