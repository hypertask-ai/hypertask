const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { load } = require("./task-route-loader.cjs");

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

function fixture(kind, scenario, flagMode) {
  const effects = [];
  const flags = [];
  const session = scenario.noAuth ? null : { userId: 985, source: "better-auth" };
  const actor = { id: 985, displayName: "QA", photoURL: "qa.png", email: "qa@example.invalid" };
  const task = { id: 42, projectId: 15, title: "Changed", nested: { retained: true } };
  const mocks = {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => {
      if (scenario.authThrows) throw new Error("Auth lookup unavailable");
      return session;
    } },
    "@/lib/flags": {
      HTPR_6923_APP_ROUTER_WRITES_FLAG: "htpr-6923-app-router-writes",
      isFeatureEnabled: async (key, userId) => {
        flags.push({ key, userId });
        if (flagMode === "throw") throw new Error("Flag lookup unavailable");
        return flagMode === true;
      },
    },
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
  const legacy = load(routeFiles[kind], {
    ...mocks,
    "@/lib/api/task-writes/route": { withTaskWriteFlag: (handler) => handler },
  }).default;
  const current = load(routeFiles[kind], mocks).default;
  const operation = load(operationFiles[kind], mocks).PUT;
  return { legacy, current, operation, session, effects, flags };
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
    test(`${kind}: original / flag-on / flag-off parity: ${name}`, async () => {
      global.Date = FixedDate;
      const originalConsole = { log: console.log, warn: console.warn, error: console.error };
      console.log = console.warn = console.error = () => {};
      try {
        const body = Object.hasOwn(scenario, "body") ? scenario.body : kind === "update" ? update : move;
        const before = fixture(kind, scenario, false);
        const expected = await invoke(before.legacy, body);
        if (scenario.expected) assert.deepEqual(expected, scenario.expected);
        for (const mode of [true, false, "throw"]) {
          const after = fixture(kind, scenario, mode);
          assert.deepEqual(await invoke(after.current, body), expected);
          assert.deepEqual(json(after.effects), json(before.effects), "mutation/query/notification/realtime arguments are unchanged");
          assert.deepEqual(after.flags, scenario.noAuth || scenario.authThrows ? [] : [{ key: "htpr-6923-app-router-writes", userId: 985 }]);
        }
        const web = fixture(kind, scenario, true);
        const result = await web.operation({ headers: new Headers(), json: async () => body });
        assert.deepEqual({ status: result.status, body: await result.json() }, expected, "Web-request handler has the same contract");
        assert.deepEqual(json(web.effects), json(before.effects));
      } finally {
        global.Date = RealDate;
        Object.assign(console, originalConsole);
      }
    });
  }
}

test("non-migrated methods never evaluate the flag or load a new operation", async () => {
  for (const kind of ["update", "move"]) {
    for (const method of ["GET", "DELETE", "POST", "PATCH"]) {
      const before = fixture(kind, {}, false);
      const after = fixture(kind, {}, true);
      assert.deepEqual(await invoke(after.current, {}, method), await invoke(before.legacy, {}, method));
      assert.deepEqual(after.flags, []);
    }
  }
});

test("flag-off does not load the new handler; flag-on failures never retry legacy", async () => {
  for (const mode of [false, true]) {
    const fx = fixture("update", {}, mode);
    const { withTaskWriteFlag } = load("src/lib/api/task-writes/route.ts", {
      "@/lib/auth/getSessionUser": { getSessionUser: async () => fx.session },
      "@/lib/flags": { HTPR_6923_APP_ROUTER_WRITES_FLAG: "htpr-6923-app-router-writes", isFeatureEnabled: async () => mode },
    });
    let legacy = 0;
    let loaded = 0;
    const handler = withTaskWriteFlag(async (_req, res) => { legacy++; res.status(200).json({ legacy: true }); }, "PUT", async () => {
      loaded++;
      return async () => { throw new Error("failed after write"); };
    });
    if (mode) await assert.rejects(invoke(handler, update), /failed after write/);
    else assert.deepEqual(await invoke(handler, update), { status: 200, body: { legacy: true } });
    assert.equal(legacy, mode ? 0 : 1);
    assert.equal(loaded, mode ? 1 : 0);
  }
});

test("original handler bodies are pinned independently of flag-on implementations", () => {
  const hashes = require("./htpr-6923-verify.cjs").legacyHashes;
  for (const [kind, file] of Object.entries(routeFiles)) {
    const source = fs.readFileSync(file, "utf8")
      .replace('import { withTaskWriteFlag } from "@/lib/api/task-writes/route";\n', "")
      .replace(/export default withTaskWriteFlag\([\s\S]*$/, "export default handler;\n");
    assert.equal(crypto.createHash("sha256").update(source).digest("hex"), hashes[kind], file);
  }
});
