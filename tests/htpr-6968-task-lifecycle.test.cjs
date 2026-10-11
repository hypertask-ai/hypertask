const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");
// Responses and effects are pinned by digest from the pre-retirement handlers (HTPR-6992).
const { pins } = require("./helpers/htpr-6992-pins.cjs");
const pin = pins("a1-lifecycle");
// Assignee narrowing loop of the pre-retirement global creator, whitespace stripped.
const globalAssigneeLoop = "for(constassigneeofassigneesas(IUser|IAgent)[]){if(isAgentAssignee(assignee)){agentAssigneeIds.push(assignee.id);constagentOwnerId=awaitgetActiveAgentOwnerId(assignee.id);if(agentOwnerId!=null){assigneeUserIds.push(agentOwnerId);normalizedAssignees.push({userId:agentOwnerId,agentId:assignee.id,});}else{hasInvalidAssignee=true;}}elseif(typeofassignee.id===\"number\"){assigneeUserIds.push(assignee.id);normalizedAssignees.push({userId:assignee.id});}else{hasInvalidAssignee=true;}}";
const ts = require("typescript");
const paths = { create: "create", global: "createGlobally", archive: "(un)archive" };
const operations = { create: "create", global: "create-global", archive: "archive" };
const clean = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const RealDate = Date;

function assertAgentTypeBinding(source) {
  const ast = ts.createSourceFile("creator.ts", source, ts.ScriptTarget.Latest, true);
  const imported = ast.statements.some(node => ts.isImportDeclaration(node) &&
    node.moduleSpecifier.text === "@/models/model" &&
    node.importClause?.namedBindings?.elements?.some(element => element.name.text === "IAgent"));
  assert.ok(imported, "global creator must import IAgent from the shared model");
  const model = ts.createSourceFile("model.ts", require("node:fs").readFileSync("src/models/model.ts", "utf8"), ts.ScriptTarget.Latest, true);
  assert.ok(model.statements.some(node => node.name?.text === "IAgent" &&
    node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)), "IAgent is an actual exported model type");
  const assigneeLoop = text => {
    const file = ts.createSourceFile("creator.ts", text, ts.ScriptTarget.Latest, true);
    let loop;
    const visit = node => {
      if (ts.isForOfStatement(node) && node.expression.getText(file).includes("IAgent")) loop = node.getText(file).replace(/\s/g, "");
      ts.forEachChild(node, visit);
    };
    visit(file);
    assert.ok(loop, "the assignee narrowing loop is exercised");
    return loop;
  };
  assert.equal(assigneeLoop(source), globalAssigneeLoop, "the restored type is used in the same byte-pinned production assignee logic");
}

test("global creators retain the exported agent type binding and production narrowing logic", () => {
  for (const file of ["src/lib/api/task-writes/create-global.ts"]) {
    const source = require("node:fs").readFileSync(file, "utf8");
    assertAgentTypeBinding(source);
    assert.throws(() => assertAgentTypeBinding(source.replace("IAgent, ILabel", "ILabel")), /must import IAgent/, "missing-import positive control");
  }
});
class FixedDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : ["2026-10-06T12:00:00Z"])); }
}
const actor = { id: 985, displayName: "QA", email: "qa@example.invalid", photoURL: "qa.png" };
const section = { id: 8, projectId: 15, section_title: "Todo" };
const defaults = {
  create: { title: "Created", description: "note", projectId: 15, userId: 985, section: "Todo", sectionId: 8, ranking: "rank", index: 0 },
  global: { title: "Created", description: "note", projectId: 15, sectionId: 8, ranking: "rank" },
  archive: { taskId: 42, status: "Archive" },
};
function fixture(kind, scenario) {
  const effects = [], background = [];
  const record = (name, value, failure) => async (...args) => {
    effects.push([name, ...clean(args)]);
    if (failure) throw new Error(failure);
    return typeof value === "function" ? value(...args) : value;
  };
  const task = { id: 42, title: "Created", projectId: 15, sectionId: 8, section: "Todo", ranking: "old-rank", uniqueIndex: 42, ticketNumber: "HTPR-42", status: "Normal", project: { id: 15, teamId: 2 }, description_: { content: "note" }, updatedByUserIds: [] };
  const session = scenario.noAuth ? null : { userId: 985, source: "better-auth" };
  class KnownError extends Error { constructor(code) { super(code); this.code = code; } }
  const db = {
    user: { findUnique: record("user", scenario.noUser ? null : actor) },
    agent: { findFirst: record("agent", scenario.unownedAgent ? null : { id: "owned", userId: 985, displayName: "Agent" }) },
    project: { findFirst: record("project", scenario.denied ? null : { id: 15 }), findUnique: record("project-index", { uniqueIdentifier: "HTPR" }) },
    section: { findFirst: record("section", scenario.missingSection ? null : section, scenario.sectionThrows ? "Section unavailable" : null) },
    task: {
      findFirst: record("rank-task", scenario.noRankTask ? null : scenario.emptyTarget ? { ...task, title: "", description_: { content: "" } } : task),
      findUnique: record("task-detail", scenario.noCreatedTask ? null : task),
      create: record("task-create", task), update: record("task-update", task),
    },
    description: { findUnique: record("description", { content: "note" }) },
    priority: { create: record("priority", { id: "priority", priority_index: 0, Priority_Value: "Urgent" }) },
    estimate: { create: record("estimate", { id: "estimate", estimate_index: 1, estimate_value: "Small" }) },
    label: { findMany: record("labels", scenario.foreignLabel ? [] : [{ id: "label" }]) },
    taskLabel: { createMany: record("attach-labels", {}), findMany: record("task-labels", [{ labelId: "label" }]) },
    assignees: { create: record("assignee", ({ data }) => ({ id: "assign", ...data, user: { ...actor, id: data.userId }, assigner: actor, agent: data.agentId ? { id: data.agentId, userId: 985 } : null })) },
    follower: { deleteMany: record("unfollow", {}) },
    notification: { create: record("agent-inbox", {}) },
    comment: { create: record("comment", { id: 13 }) },
    taskRelations: { create: record("comment-relation", {}) },
    drafts: { createMany: record("drafts", {}) },
    team_Activity: { update: record("team-count", {}) },
    $executeRaw: record("board-lock", {}),
  };
  const queue = {
    scheduleDueDateJob: record("schedule-due", undefined, scenario.queueThrows ? "Queue unavailable" : null),
    cancelDueDateJob: record("cancel-due", undefined, scenario.queueThrows ? "Queue unavailable" : null),
  };
  const mocks = {
    "@prisma/client": { Prisma: { PrismaClientKnownRequestError: KnownError } },
    "@vercel/functions": { waitUntil: (promise) => { effects.push(["waitUntil"]); background.push(promise); } },
    "@/lib/prisma": { default: db },
    "@/lib/ai/composeTaskTarget": load("src/lib/ai/composeTaskTarget.ts", {}),
    "@/lib/auth/getSessionUser": { getSessionUser: async () => { if (scenario.authThrows) throw new Error("Auth unavailable"); return session; } },
    "@/lib/auth/sessionUserRecord": { loadSessionUserRecord: record("actor", actor, scenario.actorThrows ? "Actor unavailable" : null) },
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: (token) => { effects.push(["signed-session", token]); return token === "agent-token" ? { agentId: "owned" } : null; } },
    "@/lib/auth/resolveActingAgent": { resolveActingAgent: load("src/lib/auth/resolveActingAgent.ts", {}).resolveActingAgent },
    "@/lib/ai/taskWriterDueDate": { taskWriterDueDateForSave: () => { throw new Error("Legacy parity must not resolve writer dates"); } },
    "@/lib/flags/keys": { HTPR_7054_CTRLJ_DUE_DATE_FLAG: "htpr-7054-ctrlj-due-date" },
    "@/lib/flags": {
      HTPR_6929_COMPOSE_TASK_WRITER_FLAG: "compose", HTPR_6937_NEW_TASK_WINDOW_FLAG: "new-task",
      isFeatureEnabled: async (key, userId) => {
        effects.push(["product-flag", key, userId]); return !scenario.productOff && !(key === "new-task" && scenario.newWindowOff);
      },
    },
    "@/utils/generateRank": { default: (...args) => { effects.push(["rank", ...clean(args)]); return scenario.noRank ? undefined : "new-rank"; } },
    "@/utils/controllers/tasks/create": { default: record("create", scenario.result ?? { status: 200, json: task }, scenario.writeThrows ? "Create unavailable" : null) },
    "@/utils/controllers/tasks/single": { updateTaskSingle: record("write", scenario.result ?? { status: 200, json: task }, scenario.writeThrows ? "Write unavailable" : null) },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: (userId, agentId) => ({ ownerId: userId, agentId }) },
    "@/utils/controllers/agents/boardMembers": { isAgentOnBoard: record("agent-on-board", !scenario.agentOffBoard) },
    "@/lib/mcp/tasks/services": { validateProjectMemberIds: record("members", { invalidIds: scenario.invalidMember ? [2343] : [], ...(scenario.memberError ? { error: { status: 403, message: "Forbidden members" } } : {}) }) },
    "@/utils/controllers/tasks/getNextUniqueTaskIndex": { getNextUniqueTaskIndex: record("next-index", 42) },
    "@/lib/mcp/webhooks/taskEvents": { createTaskWithBoardWebhookOutbox: async (_db, user, callback) => {
      effects.push(["transaction", user]);
      if (scenario.uniqueConflict) throw new KnownError("P2002");
      if (scenario.transactionThrows) throw new Error("Transaction unavailable");
      const result = await callback(db);
      effects.push(["commit"]);
      return { result: scenario.failedTask ? { ...result.result, task: null } : result.result, boardWebhookDeliveryIds: ["delivery"] };
    } },
    "@/lib/mcp/webhooks/outbox": { publishBoardWebhookDeliveries: record("publish", undefined, scenario.publishThrows ? "Publish unavailable" : null) },
    "@/lib/agentWebhooks/outbox": {
      persistAgentTaskCreatedPending: record("pending-marker", undefined), markAgentTaskCreatedReady: record("ready-marker", undefined),
      emitAgentTaskCreatedWebhook: record("agent-webhook", undefined, scenario.webhookThrows ? "Webhook unavailable" : null), ensurePendingAgentTaskCreatedWebhook: record("ensure-pending", undefined),
    },
    "@/lib/agentWebhooks/taskCreatedRecovery": { recoverPendingAgentTaskCreatedWebhook: record("recovery", "pending") },
    "@/utils/controllers/activities/createAssignedActivity": { assignmentActivityUserSelect: { id: true } },
    "@/utils/controllers/activities/createArchiveActivity": { default: record("archive-activity", undefined, scenario.activityThrows ? "Activity unavailable" : null) },
    "@/utils/controllers/notifications/broadcastInboxForTask": { broadcastInboxForTask: record("inboxes", undefined) },
    "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove": { default: record("archive-notification", undefined) },
    "@/utils/controllers/notifications/creation-service/check-reminder_create-notification": { default: record("user-inbox", undefined) },
    "@/lib/realtime/server": { broadcastBoardChange: record("board", undefined), broadcastTaskChange: record("detail", undefined) },
    "@/pages/api/queues/duedateQueue": queue, "../queues/duedateQueue": queue,
    "@/pages/api/queues/FAST/generateSummary": { default: record("summary", undefined) },
    "../queues/FAST/generateSummary": { default: record("summary", undefined) },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { upsertTaskToTurbopuffer: record("search", undefined), upsertCommentToTurbopuffer: record("comment-search", undefined) },
    "@/lib/ai/labelClassifier": { classifyTaskAiLabels: record("ai-labels", undefined) },
    "@/utils/controllers/assignees/autoAssignForSection": { autoAssignForSection: record("auto-assign", scenario.pendingAssignment ? "pending" : "ready") },
    "@/utils/controllers/tasks/addRelatedTasks": { addRelatedTasks: record("relations", { status: 200, json: [{ id: 9 }] }) },
    "@/utils/controllers/urls/addIntoTaskDesc": { default: record("urls", undefined) },
  };
  return { current: load(`src/pages/api/tasks/${paths[kind]}.ts`, mocks).default, web: load(`src/lib/api/task-writes/${operations[kind]}.ts`, mocks).POST, effects, background, session };
}
async function invoke(fx, body, target, scenario, method = "POST") {
  const token = scenario.signedAgent ? "agent-token" : "user-token";
  let result;
  const headers = {};
  try {
    if (target === "web") {
      const req = new Request("https://example.invalid/api/tasks", { method: "POST", headers: { cookie: `ht_session=${token}` } });
      const response = await fx.web({ headers: req.headers, json: async () => body });
      if (response) {
        response.headers.forEach((value, key) => { if (key !== "content-type") headers[key] = value; });
        result = { status: response.status, body: await response.json(), headers };
      }
    } else {
      const res = { setHeader: (name, value) => { headers[name.toLowerCase()] = value; }, status: (status) => ({ json: (value) => { result = { status, body: clean(value), headers }; return result; } }) };
      await fx[target]({ method, body, headers: { cookie: `ht_session=${token}` }, cookies: { ht_session: token }, query: { projectId: "15", sectionId: "8", position: "top" } }, res);
    }
  } catch (error) { result = { throws: String(error) }; }
  await Promise.all(fx.background);
  await Promise.resolve();
  return result;
}
const error = (status, message) => ({ status, body: { message }, headers: {} });
const scenarios = {
  create: [
    ["explicit fields and urgent index", {}],
    ["fullscreen ignores ordinary validation", { body: { fullScreenTask: true, projectId: 15, userId: 985 } }],
    ["fullscreen no section 406", { body: { ...defaults.create, fullScreenTask: true }, missingSection: true }],
    ["fullscreen controller denied", { body: { ...defaults.create, fullScreenTask: true }, result: { status: 403, json: { message: "Forbidden" } }, expected: error(403, "Forbidden") }],
    ["fullscreen created row disappeared", { body: { ...defaults.create, fullScreenTask: true }, noCreatedTask: true }],
    ["global fallback uses actor and discards description", { body: { ...defaults.create, ranking: undefined, userId: 6 } }],
    ["empty section uses supplied ranking", { body: { ...defaults.create, ranking: undefined }, noRankTask: true }],
    ["unresolved section sends no response", { body: { ...defaults.create, ranking: undefined }, noRankTask: true, missingSection: true, noResponse: true }],
    ["unresolved rank sends no response", { body: { ...defaults.create, ranking: undefined }, noRank: true, noResponse: true }],
    ["missing title", { body: { projectId: 15 }, expected: error(400, "Missing Required Information") }],
    ["missing project", { body: { title: "Created" }, expected: error(400, "Missing Required Information") }],
    ["null body", { body: null, expected: error(500, "Internal server error") }],
    ["undefined body", { body: undefined, expected: error(500, "Internal server error") }],
    ["unauthenticated invalid body", { body: {}, noAuth: true, expected: error(401, "Unauthorized") }],
    ["unauthenticated", { noAuth: true, expected: error(401, "Unauthorized") }],
    ["permission denial", { result: { status: 404, json: { message: "Task not found or access denied" } }, expected: error(404, "Task not found or access denied") }],
    ["controller validation", { result: { status: 400, json: { message: "Invalid task" } }, expected: error(400, "Invalid task") }],
    ["controller throws", { writeThrows: true, expected: error(500, "Internal server error") }],
    ["auth failure remains a rejection", { authThrows: true }], ["actor lookup failure remains a rejection", { actorThrows: true }],
  ],
  global: [
    ["minimal create", {}], ["empty title accepted", { body: { ...defaults.global, title: "" } }],
    ["all enrichment and comment fanout", { body: { ...defaults.global, priority: { priority_index: 0, Priority_Value: "Urgent" }, estimate: { estimate_index: 1, estimate_value: "Small" }, tags: [{ id: "label" }], dueDate: "2026-10-08", startDate: "2026-10-07", assignees: [{ id: 2343 }], relationsToAdd: [9], urlsToAdd: ["https://example.invalid"], createTaskFromComment: { task: { id: 9, projectId: 15, uniqueIndex: 9 }, commentIndex: 2 } } }],
    ["signed agent and agent inbox", { signedAgent: true, body: { ...defaults.global, agentId: "owned", assignees: [{ id: "owned" }] } }],
    ["forged agent", { body: { ...defaults.global, agentId: "forged" } }],
    ["unowned agent", { signedAgent: true, unownedAgent: true, expected: error(403, "Forbidden") }],
    ["agent not on board", { signedAgent: true, agentOffBoard: true, expected: error(403, "Forbidden") }],
    ["unauthenticated", { noAuth: true, expected: error(401, "Unauthorized") }],
    ["missing actor", { noUser: true, expected: error(401, "Unauthorized") }],
    ["body cannot forge actor", { body: { ...defaults.global, userId: 6 }, expected: error(403, "Forbidden") }],
    ["project validation", { body: {}, expected: error(400, "Invalid project id") }],
    ["permission denied", { denied: true, expected: error(403, "Forbidden") }],
    ["null body rejects before auth", { body: null, noAuth: true }], ["undefined body rejects before auth", { body: undefined }],
    ["auth failure rejects", { authThrows: true }],
    ["compose flag disabled", { body: { ...defaults.global, requestKind: "compose-task" }, productOff: true, expected: error(403, "Compose task writer is turned off") }],
    ["existing task requires compose", { body: { ...defaults.global, existingTaskId: 42 }, expected: error(403, "New Task window is turned off") }],
    ["compose existing nonempty task", { body: { ...defaults.global, existingTaskId: 42, requestKind: "compose-task" }, expected: error(409, "This task is no longer empty. Your note is still here.") }],
    ["compose existing empty target updates and broadcasts", { body: { ...defaults.global, existingTaskId: 42, requestKind: "compose-task" }, emptyTarget: true }],
    ["compose update controller refusal", { body: { ...defaults.global, existingTaskId: 42, requestKind: "compose-task" }, emptyTarget: true, result: { status: 409, json: { message: "Conflict" } }, expected: error(409, "Conflict") }],
    ["compose missing target", { body: { ...defaults.global, existingTaskId: 42, requestKind: "compose-task" }, noRankTask: true, expected: error(403, "Forbidden") }],
    ["existing target new-window flag disabled", { body: { ...defaults.global, existingTaskId: 42, requestKind: "compose-task" }, newWindowOff: true, expected: error(403, "New Task window is turned off") }],
    ["invalid existing task id", { body: { ...defaults.global, existingTaskId: -1, requestKind: "compose-task" }, expected: error(400, "Invalid task id") }],
    ["invalid labels", { body: { ...defaults.global, tags: "label" }, expected: error(400, "Invalid labels") }],
    ["invalid label id", { body: { ...defaults.global, tags: [{ id: 2 }] }, expected: error(400, "Invalid labels") }],
    ["foreign labels", { body: { ...defaults.global, tags: [{ id: "label" }] }, foreignLabel: true, expected: error(400, "One or more labels do not belong to this project") }],
    ["invalid assignee", { body: { ...defaults.global, assignees: [{ id: false }] }, expected: error(400, "Invalid assignee payload") }],
    ["membership lookup refusal", { body: { ...defaults.global, assignees: [{ id: 2343 }] }, memberError: true, expected: error(403, "Forbidden members") }],
    ["agent assignee not on board", { body: { ...defaults.global, assignees: [{ id: "owned" }] }, agentOffBoard: true }],
    ["agent assignee revoked", { body: { ...defaults.global, assignees: [{ id: "owned" }] }, unownedAgent: true, expected: error(400, "Invalid assignee payload") }],
    ["nonmember assignee", { body: { ...defaults.global, assignees: [{ id: 2343 }] }, invalidMember: true }],
    ["missing section", { missingSection: true, expected: error(400, "Section does not belong to this project") }],
    ["fallback active section", { body: { ...defaults.global, sectionId: undefined } }],
    ["no active fallback section", { body: { ...defaults.global, sectionId: undefined }, missingSection: true, expected: error(400, "No active section found") }],
    ["section title", { body: { ...defaults.global, sectionId: undefined, section_title: " Todo " } }],
    ["noncanonical section", { body: { ...defaults.global, sectionId: "08" }, expected: error(400, "Invalid section") }],
    ["valid Date start date", { body: { ...defaults.global, startDate: new RealDate("2026-10-07") } }],
    ["invalid Date start date", { body: { ...defaults.global, startDate: new RealDate(NaN) }, expected: error(400, "Invalid start date") }],
    ["invalid start date", { body: { ...defaults.global, startDate: "2026-02-30" }, expected: error(400, "Invalid start date") }],
    ["invalid start date type", { body: { ...defaults.global, startDate: 3 }, expected: error(400, "Invalid start date") }],
    ["missing created task result", { failedTask: true, expected: error(400, "Failed to create task") }],
    ["unique index conflict", { uniqueConflict: true, expected: error(409, "Could not allocate a unique task index for this project. Please retry.") }],
    ["transaction failure rejects without retry", { transactionThrows: true }],
    ["queue failure after commit rejects without retry", { body: { ...defaults.global, dueDate: "2026-10-08" }, queueThrows: true }],
    ["webhook publish failure rejects after commit", { publishThrows: true }],
    ["assignment recovery pending retains marker", { pendingAssignment: true }],
    ["agent webhook failure retains marker", { webhookThrows: true }],
  ],
  archive: [
    ["archive queue and inbox fanout", {}], ["unarchive does not cancel queue", { body: { taskId: 42, status: "Normal" } }],
    ["nonstandard status preserved", { body: { taskId: 42, status: "Deleted" } }],
    ["unauthenticated", { noAuth: true, expected: error(401, "Unauthorized") }],
    ["auth before validation", { noAuth: true, body: {}, expected: error(401, "Unauthorized") }],
    ["missing task id", { body: { status: "Archive" }, expected: error(400, "Missing required field") }],
    ["missing status", { body: { taskId: 42 }, expected: error(400, "Missing required field") }],
    ["null body before auth", { body: null, noAuth: true }], ["undefined body", { body: undefined }],
    ["signed agent actor", { signedAgent: true, body: { ...defaults.archive, agentId: "owned" } }],
    ["forged agent", { body: { ...defaults.archive, agentId: "borrowed" } }],
    ["unowned agent", { signedAgent: true, unownedAgent: true, expected: error(403, "Forbidden") }],
    ["missing actor", { noUser: true, expected: error(401, "Unauthorized") }],
    ["permission denial stops all effects", { result: { status: 404, json: { message: "Task not found or access denied" } }, expected: error(404, "Task not found or access denied") }],
    ["lease conflict stops effects", { result: { status: 409, json: { message: "Lease conflict" } }, expected: error(409, "Lease conflict") }],
    ["queue failure after write is 500", { queueThrows: true }],
    ["activity failure after inbox is 500", { activityThrows: true }],
    ["auth lookup error is 500", { authThrows: true }], ["write error is 500", { writeThrows: true }],
  ],
};
for (const [kind, cases] of Object.entries(scenarios)) {
  for (const [name, scenario] of cases) test(`${kind}: shared handler matches pinned contract (Pages adapter and Web): ${name}`, async () => {
    const oldConsole = { log: console.log, warn: console.warn, error: console.error };
    const oldPerformance = global.performance;
    global.Date = FixedDate; console.log = console.warn = console.error = () => {};
    const resetTime = () => { let n = 0; global.performance = { now: () => ++n }; };
    try {
      const body = Object.hasOwn(scenario, "body") ? scenario.body : defaults[kind];
      const after = fixture(kind, scenario); resetTime();
      const expected = await invoke(after, body, "current", scenario);
      if (scenario.expected) assert.deepEqual(expected, scenario.expected);
      if (scenario.noResponse) assert.equal(expected, undefined, "no JSON/status is sent");
      pin(kind, `${kind}: ${name}`, { response: expected === undefined ? null : expected, effects: clean(after.effects) });
      const web = fixture(kind, scenario); resetTime();
      assert.deepEqual(await invoke(web, body, "web", scenario), expected);
      assert.deepEqual(clean(web.effects), clean(after.effects), "queries, mutations, queue, inbox, activity, webhooks and realtime order/arguments");
      if (kind === "archive" && (scenario.result || scenario.unownedAgent || scenario.noUser)) {
        assert.ok(!after.effects.some(([name]) => ["cancel-due", "inboxes", "archive-activity", "archive-notification", "board", "detail"].includes(name)));
      }
      if (kind === "archive" && body?.status === "Normal") assert.ok(!after.effects.some(([name]) => name === "cancel-due"));
    } finally { global.Date = RealDate; global.performance = oldPerformance; Object.assign(console, oldConsole); }
  });
}
test("non-migrated methods answer 405 without running the write", async () => {
  for (const kind of Object.keys(paths)) for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
    // createGlobally keeps its own GET (section and rank defaults); pinned below.
    if (kind === "global" && method === "GET") continue;
    const after = fixture(kind, {});
    const oldPerformance = global.performance;
    try {
      global.performance = { now: () => 1 };
      assert.deepEqual(await invoke(after, {}, "current", {}, method), { status: 405, body: { message: "Method not allowed" }, headers: {} });
      assert.deepEqual(clean(after.effects), []);
    } finally { global.performance = oldPerformance; }
  }
});

test("createGlobally GET keeps the pinned section and rank defaults", async () => {
  const after = fixture("global", {});
  const oldPerformance = global.performance;
  try {
    global.performance = { now: () => 1 };
    const response = await invoke(after, {}, "current", {}, "GET");
    pin("global-get", "global GET", { response: response === undefined ? null : response, effects: clean(after.effects) });
  } finally { global.performance = oldPerformance; }
});
