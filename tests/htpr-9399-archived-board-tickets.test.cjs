const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const FLAG_KEY = "htpr-9399-archived-board-tickets";
const GUARD_FILE = "src/utils/controllers/projects/archivedBoardTickets.ts";
const FLAG_FILE = "src/lib/flags/definitions/htpr-9399-archived-board-tickets.ts";

function flagState(enabled) {
  return { isFeatureEnabled: async () => enabled };
}

function loadGuard(enabled) {
  assert.equal(fs.existsSync(GUARD_FILE), true, "archived board guard is not on this code");
  return load(GUARD_FILE, {
    "@/lib/flags": flagState(enabled),
  });
}

test("the archived board guard ships to everyone as a reversible bugfix", () => {
  assert.equal(fs.existsSync(FLAG_FILE), true, "archived board ticket flag is not on this code");
  const { default: flag } = load(FLAG_FILE);
  assert.equal(flag.key, FLAG_KEY);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
});

test("an archived board refuses new tickets and names the board", async () => {
  const { assertBoardTakesNewTickets, ArchivedBoardTicketError } = loadGuard(true);
  await assert.rejects(
    assertBoardTakesNewTickets({ name: "project-11514", title: "Fleet CI & Infra", status: "Archive" }, 6),
    (error) => {
      assert.ok(error instanceof ArchivedBoardTicketError);
      assert.match(error.message, /Fleet CI & Infra/);
      assert.match(error.message, /archived/);
      return true;
    },
  );
});

test("a board that is not archived still accepts tickets", async () => {
  const { assertBoardTakesNewTickets, archivedBoardTicketRefusal } = loadGuard(true);
  assert.equal(await assertBoardTakesNewTickets({ name: "project-15", title: "Hypertask Product", status: "Normal" }, 6), undefined);
  assert.equal(await archivedBoardTicketRefusal({ name: "project-15", title: "Hypertask Product", status: "Normal" }, 6), null);
});

test("switching the flag off lets an archived board take tickets again", async () => {
  const { archivedBoardTicketRefusal } = loadGuard(false);
  assert.equal(await archivedBoardTicketRefusal({ name: "project-11514", title: "Fleet CI & Infra", status: "Archive" }, 6), null);
});

function createHarness(board, flagEnabled) {
  const writes = [];
  const tx = {
    $executeRaw: async () => undefined,
    project: { findUnique: async () => ({ uniqueIdentifier: "TEST", firstTaskPointerTaskId: null }) },
    task: {
      create: async ({ data }) => {
        writes.push(data);
        return { ...data, id: 77, project: { teamId: null }, priority: null, taskLabels: [] };
      },
    },
  };
  const prisma = {
    project: { findFirst: async () => board },
    section: { findFirst: async () => ({ id: 9, section_title: "Backlog" }) },
    task: { count: async () => 0 },
    team_Activity: { update: async () => undefined },
    drafts: { create: async () => undefined },
  };
  const create = load("src/utils/controllers/tasks/create.ts", {
    "@/lib/agents/writing": { AgentWritingError: class extends Error {}, agentWritingDetails: () => ({}) },
    "@/lib/agents/writingEnforcement": { enforceAgentWriting: async () => undefined },
    "@/lib/planLimits": { isPlanLimitReachedError: () => false, planLimitResponse: () => ({ status: 400, body: {} }) },
    "@/lib/auth/agentScope": { recordAgentBoardScopeMiss: () => undefined },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "../description/common-description-create": { default: async () => undefined },
    "@/lib/flags": flagState(flagEnabled),
    "@vercel/functions": { waitUntil: () => undefined },
    "@/lib/ai/labelClassifier": { scheduleClassifyNewTaskAiLabels: () => undefined },
    "./getNextUniqueTaskIndex": { getNextUniqueTaskIndex: async () => 42 },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "@/utils/controllers/assignees/autoAssignForSection": { autoAssignForSection: async () => "ready" },
    "@/lib/mcp/webhooks/taskEvents": {
      createTaskWithBoardWebhookOutbox: async (_db, _actor, run) => {
        const written = await run(tx);
        return { result: written.result, boardWebhookDeliveryIds: [] };
      },
    },
    "@/lib/mcp/webhooks/outbox": { publishBoardWebhookDeliveries: async () => undefined },
    "@/lib/agentWebhooks/outbox": {
      emitAgentTaskCreatedWebhook: async () => undefined,
      markAgentTaskCreatedReady: async () => undefined,
      persistAgentTaskCreatedPending: async () => undefined,
    },
  }).default;
  const call = () => create({
    title: "A ticket",
    description: "",
    section: "Backlog",
    userId: 6,
    ranking: "r",
    projectId: 11514,
    sectionId: 9,
    currentUser: { id: 6 },
  });
  return { call, writes };
}

test("creating a ticket on an archived board is refused with the board name and nothing is written", async () => {
  const { call, writes } = createHarness({ id: 11514, name: "project-11514", title: "Fleet CI & Infra", status: "Archive" }, true);
  const response = await call();
  assert.equal(response.status, 400);
  assert.match(response.json.message, /Fleet CI & Infra/);
  assert.match(response.json.message, /archived/);
  assert.equal(writes.length, 0);
});

test("creating a ticket on an active board still succeeds", async () => {
  const { call, writes } = createHarness({ id: 15, name: "project-15", title: "Hypertask Product", status: "Normal" }, true);
  const response = await call();
  assert.equal(response.status, 200);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].title, "A ticket");
});

function moveHarness(targetBoard, flagEnabled) {
  const movedRecords = [];
  const prisma = {
    project: {
      findUnique: async ({ where }) => (where.id === targetBoard.id ? targetBoard : { id: 15, teamId: null }),
      findFirst: async () => ({ id: targetBoard.id }),
    },
    section: { findUnique: async () => ({ id: 10, projectId: targetBoard.id, section_title: "Backlog" }) },
    task: {
      findUnique: async ({ where }) => (where.id === 501
        ? { id: 501, projectId: 15, parentTaskId: 500, subTasks: [] }
        : { id: 500, projectId: 15, parentTaskId: null, subTasks: [{ id: 501, subTasks: [] }] }),
      findFirst: async () => null,
      update: async () => undefined,
    },
    page: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    $transaction: async (run) => run({ page: { findMany: async () => [], updateMany: async () => ({ count: 0 }) } }),
    $queryRaw: async () => [],
    estimate: { updateMany: async () => undefined },
    priority: { updateMany: async () => undefined },
    savedContent: { updateMany: async () => undefined },
    notification: { deleteMany: async () => undefined },
    drafts: { deleteMany: async () => undefined },
    reminder: { deleteMany: async () => undefined },
    assignees: { findMany: async () => [], deleteMany: async () => undefined },
    member_Team: { findFirst: async () => null },
    follower: { findMany: async () => [], deleteMany: async () => undefined },
    taskLabel: { findMany: async () => [] },
  };
  const { moveTaskToDifferentBoard } = load("src/utils/controllers/tasks/moveToDifferentBoard.ts", {
    "@/lib/planLimits": {
      assertTicketRoom: async () => undefined,
      isPlanLimitsEnabled: async () => false,
      isPlanLimitReachedError: () => false,
      scopeForProject: () => ({}),
      scopeKey: () => "",
    },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@prisma/client": { Prisma: { join: (values) => values } },
    "@/utils/controllers/getMemberAndOwnerForBoard": { default: async () => [] },
    "@/utils/generateRank": { default: () => "rank" },
    "./getNextUniqueTaskIndex": { getNextUniqueTaskIndex: async () => 9 },
    "@/pages/api/queues/duedateQueue": { cancelDueDateJob: async () => undefined, scheduleDueDateJob: async () => undefined },
    "date-fns": { subMinutes: (value) => value },
    "@/utils/controllers/tasks/single": {
      TASK_IDENTITY_CONFLICT_CODE: "task_identity_conflict",
      updateTaskSingle: async (data) => {
        movedRecords.push(data);
        return { status: 200, json: { id: data.id, projectId: data.projectId } };
      },
    },
    "@/lib/api/errorMessage": { toErrorMessage: (json, fallback) => json?.message ?? fallback },
    "@/utils/controllers/assignees/autoAssignForSection": { autoAssignForSection: async () => "ready" },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "../turbopuffer/turbopufferHelper": { upsertPageToTurbopuffer: async () => undefined },
    "@/lib/flags": flagState(flagEnabled),
  });
  const call = () => moveTaskToDifferentBoard({
    taskId: 500,
    targetProjectId: targetBoard.id,
    targetSectionId: 10,
    currentProjectId: 15,
    currentUser: { id: 6 },
  });
  return { call, movedRecords };
}

test("moving a ticket into an archived board is refused with the board name and the ticket stays put", async () => {
  const { call, movedRecords } = moveHarness({ id: 11514, name: "project-11514", title: "Fleet CI & Infra", status: "Archive", uniqueIdentifier: "HYCI" }, true);
  const result = await call();
  assert.equal(result.success, false);
  assert.equal(result.statusCode, 400);
  assert.match(result.error, /Fleet CI & Infra/);
  assert.match(result.error, /archived/);
  assert.equal(movedRecords.length, 0);
});

test("moving a ticket into an active board still moves it", async () => {
  const { call, movedRecords } = moveHarness({ id: 16, name: "project-16", title: "Fleet CI & Infra", status: "Normal", uniqueIdentifier: "HTPR" }, true);
  const result = await call();
  assert.equal(result.success, true);
  assert.equal(movedRecords.length, 2);
});

function mcpAccess(board, flagEnabled) {
  const projectQueries = [];
  const prisma = {
    project: {
      findFirst: async ({ where }) => {
        projectQueries.push(where);
        if (where.status === "Normal") return null;
        const matches = board.status === where.status;
        return matches ? { id: board.id, name: board.name, title: board.title, status: board.status } : null;
      },
    },
  };
  const { validateProjectAccess } = load("src/lib/mcp/tasks/services.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/flags": flagState(flagEnabled),
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
  });
  return { validateProjectAccess, projectQueries };
}

test("MCP create and move refuse an archived board with the same archived error as the API", async () => {
  const { validateProjectAccess } = mcpAccess({ id: 11514, name: "project-11514", title: "Fleet CI & Infra", status: "Archive" }, true);
  const result = await validateProjectAccess(11514, 6, null, null, { refuseArchivedBoard: true });
  assert.equal(result.error.status, 400);
  assert.match(result.error.message, /Fleet CI & Infra/);
  assert.match(result.error.message, /archived/);
});

test("MCP board lookups outside the create and move paths keep the 404 and the flag switch", async () => {
  const board = { id: 11514, name: "project-11514", title: "Fleet CI & Infra", status: "Archive" };
  const withoutOption = await mcpAccess(board, true).validateProjectAccess(11514, 6, null, null);
  assert.equal(withoutOption.error.status, 404);
  const flagOff = await mcpAccess(board, false).validateProjectAccess(11514, 6, null, null, { refuseArchivedBoard: true });
  assert.equal(flagOff.error.status, 404);
});

test("the MCP create and move operations ask the board lookup to refuse archived boards", () => {
  const fs = require("node:fs");
  for (const file of ["src/lib/mcp/operations/tasks/create/operation.ts", "src/lib/mcp/operations/tasks/move/operation.ts"]) {
    assert.match(fs.readFileSync(file, "utf8"), /validateProjectAccess\([^)]*\{ refuseArchivedBoard: true \}\)/, `${file} must refuse archived boards`);
  }
});
