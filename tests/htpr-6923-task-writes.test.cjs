const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");
// Responses and effects are pinned by digest from the pre-retirement handlers (HTPR-6992).
const { pins } = require("./helpers/htpr-6992-pins.cjs");
const pin = pins("a1-task-writes");

const routeFiles = {
  update: "src/pages/api/tasks/single.ts",
  move: "src/pages/api/tasks/moveTask.ts",
};
const operationFiles = {
  update: "src/lib/api/task-writes/update.ts",
  move: "src/lib/api/task-writes/move.ts",
};
const json = (value) => JSON.parse(JSON.stringify(value));
const fixedNow = "2026-10-06T12:00:00.000Z";
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fixedNow])); }
}

function fixture(kind, scenario) {
  const effects = [];
  const session = scenario.noAuth ? null : { userId: 985, source: "better-auth", ...(typeof scenario.body?.agentId === "string" && scenario.body.agentId ? { agentId: scenario.body.agentId } : {}) };
  const actor = { id: 985, displayName: "QA", photoURL: "qa.png", email: "qa@example.invalid" };
  const task = { id: 42, projectId: 15, title: "Changed", nested: { retained: true } };
  const mocks = {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => {
      if (scenario.authThrows) throw new Error("Auth lookup unavailable");
      return session;
    } },
    "@/lib/auth/sessionUserRecord": {
      loadSessionUserRecord: async (userId) => {
        effects.push(["actor", userId]);
        return actor;
      },
    },
    "@/lib/prisma": { default: {
      task: {
        findUnique: async (args) => { effects.push(["task", args]); return scenario.missingTask ? null : { projectId: 15 }; },
        findFirst: async (args) => { effects.push(["rank-task", args]); return scenario.emptySection ? null : { ranking: "rank-old" }; },
      },
      user: { findUnique: async (args) => { effects.push(["user", args]); return scenario.missingUser ? null : actor; } },
      agent: {
        findFirst: async (args) => { effects.push(["owned-agent", args]); return scenario.unownedAgent ? null : { id: args.where.id }; },
        findUnique: async (args) => { effects.push(["move-agent", args]); return { id: args.where.id, userId: 985, displayName: "Agent" }; },
      },
      project: { findFirst: async (args) => {
        effects.push(["project", args]);
        return (scenario.deniedSource && args.where.id === 15) || (scenario.deniedDestination && args.where.id === 99) ? null : { id: args.where.id };
      } },
      section: { findFirst: async (args) => { effects.push(["section", args]); return scenario.missingSection ? null : { id: args.where.id }; } },
    } },
    "@/utils/controllers/projects/getAllIncludes": {
      taskWriteAccessWhere: (userId, agentId) => ({ ownerId: userId, agentId }),
    },
    "@/utils/controllers/tasks/single": {
      updateTaskSingle: async (body, user, agentId, options) => {
        effects.push(["write", json(body), json(user), agentId, options?.taskMovedActivity?.fromAgent ?? null]);
        if (scenario.writeThrows) throw new Error("Write unavailable");
        const result = scenario.result ?? { status: 200, json: task };
        if (result.status === 200 && options?.taskMovedActivity) await options.taskMovedActivity.sendNotification();
        return result;
      },
      getTaskSingle: async () => ({ status: 200, json: task }),
      deleteTaskSingle: async () => ({ status: 200, json: { deleted: true } }),
    },
    "@/lib/realtime/server": {
      broadcastBoardChange: (id, options) => effects.push(["board", id, options]),
      broadcastTaskChange: async (id, options) => {
        effects.push(["detail", id, options]);
        if (scenario.broadcastThrows) throw new Error("Realtime unavailable");
      },
    },
    "@/utils/controllers/comments/extractTaskReferences": {
      extractTaskReferencesFromCommentText: (text) => { effects.push(["extract", text]); return scenario.noRefs ? [] : ["HTPR-6923"]; },
    },
    "@/utils/controllers/tasks/addRelatedTasks": {
      addRelatedTasks: async (...args) => {
        effects.push(["relations", ...args]);
        if (scenario.relationsThrow) throw new Error("Relation unavailable");
      },
    },
    "@/utils/generateRank": { default: (...args) => { effects.push(["generate-rank", ...args]); return "rank-new"; } },
    "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove": {
      default: (...args) => effects.push(["notify", ...args]),
    },
  };
  const current = load(routeFiles[kind], mocks).default;
  const operation = load(operationFiles[kind], mocks).PUT;
  return { current, operation, effects };
}

async function invoke(handler, body, method = "PUT") {
  let response;
  const res = { status(status) {
    return { json(payload) { response = { status, body: json(payload) }; return response; } };
  } };
  await handler({ method, headers: { cookie: "synthetic-session" }, body, query: { id: "42" }, cookies: {} }, res);
  await Promise.resolve();
  assert.ok(response, "handler sent a response");
  return response;
}

const update = { newTask: { id: 42, projectId: 15, title: "Changed", unknownField: { keep: true } } };
const move = { taskId: 42, section_title: "Done", sectionId: 8, projectId: 15, ranking: "rank-explicit" };
const scenarios = {
  update: [
    ["success with all task fields", {}],
    ["description references and broadcasts", { body: { newTask: { id: 42, description: "HTPR-6923" } } }],
    ["no description references", { body: { newTask: { id: 42, description: "plain" } }, noRefs: true }],
    ["description relation failure is non-fatal", { body: { newTask: { id: 42, description: "HTPR-6923" } }, relationsThrow: true }],
    ["task realtime failure is non-fatal", { broadcastThrows: true }],
    ["missing id", { body: {}, expected: { status: 400, body: { message: "Task id is required" } } }],
    ["zero id", { body: { newTask: { id: 0 } }, expected: { status: 400, body: { message: "Task id is required" } } }],
    ["primitive body", { body: "text", expected: { status: 400, body: { message: "Task id is required" } } }],
    ["null body", { body: null, expected: { status: 500, body: { message: "Internal server error" } } }],
    ["missing body", { body: undefined, expected: { status: 500, body: { message: "Internal server error" } } }],
    ["no auth", { noAuth: true, expected: { status: 401, body: { message: "Unauthorized" } } }],
    ["validation before auth", { body: {}, noAuth: true, expected: { status: 400, body: { message: "Task id is required" } } }],
    ["auth lookup failure", { authThrows: true, expected: { status: 500, body: { message: "Internal server error" } } }],
    ["body cannot forge actor or flag cohort", { body: { ...update, userId: 6, currentUser: { id: 6 } } }],
    ["invalid agent id", { body: { ...update, agentId: 3 }, expected: { status: 400, body: { message: "Invalid agent id" } } }],
    ["empty agent id", { body: { ...update, agentId: "" }, expected: { status: 400, body: { message: "Invalid agent id" } } }],
    ["owned agent", { body: { ...update, agentId: "owned" } }],
    ["unowned or revoked agent", { body: { ...update, agentId: "borrowed" }, unownedAgent: true, expected: { status: 403, body: { message: "Forbidden" } } }],
    ["source board denied", { deniedSource: true, expected: { status: 403, body: { message: "Forbidden" } } }],
    ["destination board denied", { body: { newTask: { ...update.newTask, projectId: 99 } }, deniedDestination: true, expected: { status: 403, body: { message: "Forbidden" } } }],
    ["missing task", { missingTask: true, result: { status: 404, json: { message: "Not found" } } }],
    ["missing actor display retains fallbacks", { missingUser: true }],
    ["controller validation", { result: { status: 400, json: { message: "Invalid task mutation", code: "invalid" } } }],
    ["lease conflict", { result: { status: 409, json: { message: "Lease conflict", current: { id: 42 } } } }],
    ["controller denied", { result: { status: 404, json: { message: "Task not found or access denied" } } }],
    ["controller throws", { writeThrows: true, expected: { status: 500, body: { message: "Internal server error" } } }],
    ["null success payload", { result: { status: 200, json: null } }],
  ],
  move: [
    ["success with explicit rank", {}],
    ["success includes move activity", { result: { status: 200, json: { id: 42 }, moveActivity: { newComment: { id: "activity", text: "Moved" } } } }],
    ["generated rank", { body: { ...move, ranking: undefined } }],
    ["empty section rank", { body: { ...move, ranking: "" }, emptySection: true }],
    ["agent notification attribution", { body: { ...move, agentId: "owned" } }],
    ["missing required fields", { body: {}, expected: { status: 400, body: { message: "Missing Required Information" } } }],
    ["null body", { body: null, expected: { status: 500, body: { message: "Internal server error" } } }],
    ["no auth", { noAuth: true, expected: { status: 401, body: { message: "Unauthorized" } } }],
    ["auth before validation", { body: {}, noAuth: true, expected: { status: 401, body: { message: "Unauthorized" } } }],
    ["missing task", { missingTask: true, expected: { status: 400, body: { message: "Invalid task or section" } } }],
    ["cross-board task", { body: { ...move, projectId: 99 }, expected: { status: 400, body: { message: "Invalid task or section" } } }],
    ["missing target section", { missingSection: true, expected: { status: 400, body: { message: "Invalid task or section" } } }],
    ["permission denied by shared write", { result: { status: 404, json: { message: "Task not found or access denied" } } }],
    ["nested lease conflict message", { result: { status: 409, json: { message: { message: "Lease conflict" } } } }],
    ["controller validation", { result: { status: 400, json: { error: "Invalid task mutation" } } }],
    ["empty error fallback", { result: { status: 500, json: {} } }],
    ["controller throws", { writeThrows: true, expected: { status: 500, body: { message: "Internal server error" } } }],
  ],
};

for (const kind of Object.keys(scenarios)) {
  for (const [name, scenario] of scenarios[kind]) {
    test(`${kind}: shared handler matches pinned contract: ${name}`, async () => {
      global.Date = FixedDate;
      const originalConsole = { log: console.log, warn: console.warn, error: console.error };
      console.log = console.warn = console.error = () => {};
      try {
        const body = Object.hasOwn(scenario, "body") ? scenario.body : kind === "update" ? update : move;
        const after = fixture(kind, scenario);
        const response = await invoke(after.current, body);
        if (scenario.expected) assert.deepEqual(response, scenario.expected);
        const expected = pin(kind, `${kind}: ${name}`, { response, effects: json(after.effects) });
        const web = fixture(kind, scenario);
        const result = await web.operation({ headers: new Headers(), json: async () => body });
        assert.deepEqual({ status: result.status, body: await result.json() }, expected.response, "Web-request handler has the same contract");
        assert.deepEqual(json(web.effects), expected.effects);
      } finally {
        global.Date = RealDate;
        Object.assign(console, originalConsole);
      }
    });
  }
}

test("non-migrated methods answer 405 without loading the operation", async () => {
  for (const kind of ["update", "move"]) {
    for (const method of kind === "update" ? ["POST", "PATCH"] : ["GET", "DELETE", "POST", "PATCH"]) {
      const after = fixture(kind, {});
      assert.deepEqual(await invoke(after.current, {}, method), { status: 405, body: { message: "Method not allowed" } });
      assert.deepEqual(after.effects, []);
    }
  }
});
