const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const { load } = require("./task-route-loader.cjs");
const { slice3Routes, slice3LegacySources } = require("./htpr-6923-verify.cjs");
const { isRecurrenceRule, RECURRENCE_RULES } = load("src/lib/recurrence.ts", {});
const { isTaskRelationType, taskRelationTypes } = load("src/utils/controllers/tasks/addRelatedTasks.ts", {
  "@/lib/prisma": { default: {} },
  "@/utils/controllers/projects/getAllIncludes": {},
});
const clean = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const actor = { id: 985, displayName: "QA", photoURL: "qa.png", email: "qa@example.invalid" };
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : ["2026-10-06T12:00:00Z"])); }
}
class LeaseError extends Error {}
class DeleteError extends Error {}
class LinkError extends Error {
  constructor() { super("Invalid pull request"); this.status = 422; this.code = "INVALID_URL"; }
}
const defaults = {
  recoverTask: { taskId: 42 }, deleteTask: undefined,
  setDueDate: { taskId: 42, dueDate: "2026-10-08T12:00:00Z" },
  setStartDate: { taskId: 42, startDate: "2026-10-07" },
  setRecurrence: { taskId: 42, recurrence: "Daily" },
  addParent: { orphanId: 42, parentId: 43 }, removeParent: { childId: 42 },
  addRelations: { relations: { currentTaskId: "42", relatedTasks: [{ projectId: 16, uniqueIndex: 43, relationType: "RelatedTo" }] } },
  removeRelation: { relationId: "9" }, "waiting-on": { taskId: 42, userId: 2343 },
  reactToDescription: { taskId: 42, descriptionId: "desc", unified: "smile", emoji: "😃", names: ["smile"] },
  linkPullRequest: { taskId: 42, url: "https://github.com/example/app/pull/1" },
};
function fixture(name, scenario, mode) {
  const effects = [], flags = [], loads = [];
  let authCalls = 0;
  const session = scenario.noAuth ? null : { userId: 985, source: "better-auth" };
  const failure = kind => {
    if (kind === "lease") return new LeaseError("Task lease conflict");
    if (kind === "delete") return new DeleteError("Hard deletion in progress");
    if (kind === "link") return new LinkError();
    return new Error(kind);
  };
  const record = (key, value, error) => async (...args) => {
    effects.push([key, ...clean(args)]);
    if (error) throw failure(error);
    return typeof value === "function" ? value(...args) : value;
  };
  const dueDate = new RealDate("2026-10-08T12:00:00Z");
  const task = { id: 42, projectId: 15, dueDate, waitingOnUserId: scenario.oldWaitingOn ?? 1234 };
  const result = scenario.result ?? { status: 200, json: task, oldTask: { dueDate: scenario.unchangedDue ? dueDate : null } };
  const relationResult = scenario.result ?? { status: 200, json: [{ id: 9, targetTask: { projectId: scenario.sameBoard ? 15 : 16 } }] };
  const reaction = { id: 3, taskId: 42, userId: 985, emoji: "😃", task: { id: 42, projectId: 15, uniqueIndex: 42, userId: 1234, title: "Task" }, user: actor, description: { creatorId: scenario.selfReaction ? 985 : 1234, content: scenario.descriptionContent ?? "<p>Note</p>" } };
  const queue = { cancelTaskDeleteJob: record("cancel-delete", undefined, scenario.queueThrows && "Queue unavailable") };
  const recovery = { TaskHardDeleteInProgressError: DeleteError, updateTaskAndSubtasks: record("restore", task, scenario.writeThrows) };
  const dueQueue = { cancelDueDateJob: record("cancel-due", undefined, scenario.queueThrows && "Queue unavailable"), scheduleDueDateJob: record("schedule-due", undefined, scenario.scheduleThrows && "Queue unavailable") };
  const mocks = {
    "date-fns": require("date-fns"),
    "@/lib/auth/getSessionUser": { getSessionUser: async () => { authCalls++; if (scenario.authThrows) throw failure("Auth unavailable"); return session; } },
    "@/lib/auth/sessionUserRecord": { loadSessionUserRecord: record("actor", actor, scenario.actorThrows && "Actor unavailable") },
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: token => {
      effects.push(["signed-session", token]);
      if (scenario.signedThrows) throw failure("Signed session unavailable");
      return scenario.noAuth || scenario.noSigned ? null : { id: scenario.signedUser ?? 985 };
    } },
    "@/lib/flags/keys": { HTPR_6923_APP_ROUTER_WRITES_FLAG: "htpr-6923-app-router-writes" },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => { flags.push([key, userId]); if (mode === "outage") throw failure("Flag unavailable"); return mode === true; } },
    "@/lib/prisma": { default: {
      task: { findFirst: record("task-access", scenario.denied ? null : task, scenario.lookupThrows && "Lookup unavailable"), findUnique: record("task-board", task), update: record("waiting-write", ({ data }) => ({ id: 42, ...data }), scenario.writeThrows) },
      agent: { findFirst: record("owned-agent", scenario.unownedAgent ? null : { id: "owned" }), findUnique: record("agent", { id: "owned", userId: 985 }) },
      taskRelations: { findFirst: record("relation-access", scenario.denied ? null : { sourceTask: { projectId: 15 }, targetTask: { projectId: scenario.sameBoard ? 15 : 16 } }) },
      user: { findUnique: record("waiting-user", scenario.noWaitingUser ? null : { displayName: "Member" }) },
      description: { findFirst: record("description", scenario.noDescription ? null : { id: "desc" }) },
      reaction: { findMany: record("find-reaction", scenario.existingReaction ? [reaction] : []), create: record("reaction-create", reaction, scenario.writeThrows), deleteMany: record("reaction-delete", {}, scenario.writeThrows) },
      subscribedDevices: { findMany: record("devices", [{ id: "device" }]) },
    } },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: (id, agentId) => ({ userId: id, agentId }), getProjectWhere: id => ({ userId: id }) },
    "@/utils/controllers/tasks/single": { updateTaskSingle: record("write", result, scenario.writeThrows) },
    "@/utils/controllers/tasks/assertTaskAccess": { userCanAccessTask: record("access", !scenario.denied), userCanAccessTaskContent: record("content-access", !scenario.denied) },
    "@/utils/controllers/tasks/addParent": { default: () => { throw new Error("Unused legacy import must not be called"); } },
    "@/utils/controllers/tasks/addRelatedTasks": { addRelatedTasks: record("add-relations", relationResult, scenario.writeThrows), isTaskRelationType },
    "@/utils/controllers/tasks/removeRelatedTask": { removeRelatedTask: record("remove-relation", scenario.result ?? { status: 200, json: { id: 9 } }, scenario.writeThrows) },
    "@/lib/recurrence": { isRecurrenceRule },
    "@/lib/realtime/server": { broadcastBoardChange: record("board", undefined), broadcastTaskChange: record("detail", undefined, scenario.realtimeThrows && "Realtime unavailable"), broadcastInboxChange: record("inbox", undefined) },
    "@/utils/controllers/activities/createTaskDueDateActivity": { default: record("due-activity", undefined) },
    "@/utils/controllers/activities/createActivity": { default: record("waiting-activity", undefined, scenario.activityThrows && "Activity unavailable") },
    "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove": { default: record("due-notification", undefined) },
    "@/lib/mcp/tasks/services": { validateProjectMemberIds: record("members", { invalidIds: scenario.nonMember ? [2343] : [], ...(scenario.memberError ? { error: { status: 403, message: "Forbidden members" } } : {}) }) },
    "@/lib/mcp/tasks/agentMutationFence": { AgentMutationLeaseConflictError: LeaseError },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { upsertTaskToTurbopuffer: record("search", undefined) },
    "@/utils/controllers/tasks/invokeTaskDelete": { permanentlyDeleteTask: record("delete", scenario.deleteConflict ? "conflict" : "success", scenario.writeThrows) },
    "@/lib/pullRequests/taskPullRequests": { PullRequestLinkError: LinkError, linkTaskPullRequest: record("link", { created: !scenario.existingLink, pullRequest: { id: "pr" } }, scenario.writeThrows) },
    "@/utils/controllers/tasks/getTask": { getReactionsByDescriptionId: record("reactions", [{ id: 3 }]) },
    "@/utils/controllers/notifications/creation-service/check-reminder_create-notification": { default: record("reaction-inbox", !scenario.noNotification, scenario.notificationThrows && "Notification unavailable") },
    "@/utils/controllers/FCM": { sendDataNewCommentFCM: record("push", undefined) },
    "../queues/taskDeleteQueue": queue, "@/pages/api/queues/taskDeleteQueue": queue,
    "../queues/tasks/taskDeleteReminder": recovery, "@/pages/api/queues/tasks/taskDeleteReminder": recovery,
    "../queues/duedateQueue": dueQueue, "@/pages/api/queues/duedateQueue": dueQueue,
  };
  const { module: operation, method } = slice3Routes[name];
  const web = load(`src/lib/api/task-writes/${operation}.ts`, mocks)[method];
  mocks[`@/lib/api/task-writes/${operation}`] = { get [method]() { loads.push(operation); return web; } };
  const original = slice3LegacySources()[name];
  const compiled = ts.transpileModule(original, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(specifier => {
    assert.ok(Object.hasOwn(mocks, specifier), `Unexpected original dependency: ${specifier}`);
    const mock = mocks[specifier]; return Object.hasOwn(mock, "default") ? { __esModule: true, ...mock } : mock;
  }, mod, mod.exports);
  return { legacy: mod.exports.default, current: load(`src/pages/api/tasks/${name}.ts`, mocks).default, web, effects, flags, loads, session, authCalls: () => authCalls };
}
async function invoke(fx, name, scenario, target, method = slice3Routes[name].method) {
  const body = Object.hasOwn(scenario, "body") ? scenario.body : defaults[name];
  const query = Object.hasOwn(scenario, "query") ? scenario.query : { taskId: "42" };
  let result;
  try {
    if (target === "web") {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
      const request = new Request(`https://example.invalid/api/tasks/${name}?${params}`, { method, headers: { cookie: "ht_session=user-token" } });
      const response = await fx.web({ url: request.url, headers: request.headers, json: async () => body });
      if (response) { const text = await response.text(); result = { status: response.status, body: text ? JSON.parse(text) : undefined }; }
    } else {
      const res = { setHeader: () => {}, status: status => ({ json: value => { result = { status, body: clean(value) }; return result; } }) };
      await fx[target]({ method, body, query, headers: { cookie: "ht_session=user-token" }, cookies: { ht_session: "user-token" } }, res);
    }
  } catch (error) { result = { throws: String(error) }; }
  await Promise.resolve();
  return result;
}
const error = (status, message) => ({ status, body: { message } });
const scenarios = {
  recoverTask: [
    ["normal subtree restore", {}], ["best-effort cancellation failure is success", { queueThrows: true, expected: error(200, "Success") }],
    ["owned agent", { body: { taskId: 42, agentId: "owned" } }], ["unowned agent", { body: { taskId: 42, agentId: "owned" }, unownedAgent: true, expected: error(403, "Forbidden") }],
    ["invalid agent", { body: { taskId: 42, agentId: 3 }, expected: error(400, "Invalid agent id") }],
    ["negative task", { body: { taskId: -1 }, expected: error(400, "Missing required information") }], ["NaN retains legacy access lookup", { body: {} }],
    ["denied", { denied: true, expected: error(404, "Task not found or access denied") }], ["lease conflict", { writeThrows: "lease", expected: error(409, "Task lease conflict") }],
    ["hard-delete claim", { writeThrows: "delete", expected: error(409, "Hard deletion in progress") }], ["lookup throws", { lookupThrows: true }], ["write throws", { writeThrows: "Write unavailable" }],
  ],
  deleteTask: [
    ["permanent delete", {}], ["restore/delete conflict", { deleteConflict: true, expected: error(409, "Task is being restored or permanently deleted") }],
    ["denied or not deleted", { denied: true, expected: error(404, "Task not found or access denied") }], ["invalid task", { query: { taskId: "NaN" }, expected: error(400, "Missing required information") }],
    ["validation before auth", { query: { taskId: "NaN" }, noAuth: true, expected: error(400, "Missing required information") }],
    ["missing query", { query: {}, expected: error(400, "Missing required information") }], ["query array", { query: { taskId: ["42", "43"] }, expected: error(400, "Missing required information") }],
    ["single query array", { query: { taskId: ["42"] } }], ["empty query remains zero", { query: { taskId: "" } }], ["zero remains valid", { query: { taskId: "0" } }],
    ["negative", { query: { taskId: "-1" }, expected: error(400, "Missing required information") }], ["fraction", { query: { taskId: "42.5" }, expected: error(400, "Missing required information") }],
    ["lookup throws", { lookupThrows: true }], ["write throws", { writeThrows: "Delete unavailable" }],
  ],
  setDueDate: [
    ["set and schedule", {}], ["clear cancels only", { body: { taskId: 42, dueDate: null } }], ["unchanged no notification", { unchangedDue: true }],
    ["agent attribution", { body: { ...defaults.setDueDate, agentId: "owned", userId: 6 } }],
    ["denied before queue/activity", { result: { status: 403, json: { message: "Forbidden" } }, expected: error(403, "Forbidden") }],
    ["queue failure after write", { queueThrows: true }], ["schedule failure after write", { scheduleThrows: true }], ["write throws", { writeThrows: "Write unavailable" }],
  ],
  setStartDate: [
    ["set", {}], ["clear", { body: { taskId: 42, startDate: null } }], ["forged agent ignored", { body: { ...defaults.setStartDate, agentId: "forged" } }],
    ["denied", { denied: true, expected: error(404, "Task not found") }], ["controller refusal", { result: { status: 409, json: { message: "Conflict" } }, expected: error(409, "Conflict") }], ["write throws", { writeThrows: "Write unavailable" }],
  ],
  setRecurrence: [
    ["set", {}], ["clear", { body: { taskId: 42, recurrence: null } }], ["invalid rule", { body: { taskId: 42, recurrence: {} }, expected: error(400, "Invalid recurrence rule") }],
    ["forged agent ignored", { body: { ...defaults.setRecurrence, agentId: "forged" } }], ["denied", { denied: true, expected: error(404, "Task not found") }],
    ["controller refusal", { result: { status: 409, json: { message: "Conflict" } } }], ["write throws", { writeThrows: "Write unavailable" }],
  ],
  addParent: [["set", {}], ["missing parent", { body: { orphanId: 42 }, expected: { status: 200, body: "Missing Required Data" } }], ["refused", { result: { status: 409, json: { message: "Cycle" } } }], ["write throws as empty array", { writeThrows: "Write unavailable", expected: { status: 200, body: [] } }]],
  removeParent: [["clear", {}], ["missing child", { body: {}, expected: { status: 200, body: "Missing Required Data" } }], ["refused", { result: { status: 403, json: { message: "Forbidden" } } }], ["write throws as empty array", { writeThrows: "Write unavailable", expected: { status: 200, body: [] } }]],
  addRelations: [
    ["cross-board broadcast", {}], ["same board once", { sameBoard: true }], ["missing", { body: {}, expected: { status: 200, body: "Missing Required Data" } }],
    ["invalid type", { body: { relations: { relatedTasks: [{ relationType: "invalid" }] } }, expected: error(400, "Invalid relation type") }],
    ["optional type", { body: { relations: { currentTaskId: "42", relatedTasks: [{ taskId: 43 }] } } }], ["malformed relatedTasks caught", { body: { relations: { relatedTasks: "bad" } }, expected: { status: 200, body: undefined } }],
    ["controller refusal", { result: { status: 403, json: { message: "Forbidden" } }, expected: error(403, "Forbidden") }], ["write throws as empty body", { writeThrows: "Write unavailable", expected: { status: 200, body: undefined } }],
  ],
  removeRelation: [
    ["nested response retained", {}], ["same board once", { sameBoard: true }], ["missing", { body: {}, expected: { status: 200, body: "Missing Required Data" } }],
    ["both tasks access denied", { denied: true, expected: error(404, "Relation not found") }], ["controller refusal", { result: { status: 403, json: { message: "Forbidden" } } }],
    ["write throws as empty body", { writeThrows: "Write unavailable", expected: { status: 200, body: undefined } }],
  ],
  "waiting-on": [
    ["set and both inboxes", {}], ["clear", { body: { taskId: 42, userId: null } }], ["same person dedupes inbox", { oldWaitingOn: 2343 }],
    ["denied", { denied: true, expected: error(404, "Task not found") }], ["nonmember", { nonMember: true, expected: error(400, "User 2343 is not a member of this project.") }],
    ["membership error", { memberError: true, expected: error(403, "Forbidden members") }], ["missing user record", { noWaitingUser: true }],
    ["bad input", { body: { taskId: "bad", userId: "bad" }, expected: error(400, "Bad request") }], ["activity failure after write", { activityThrows: true, expected: error(500, "Internal server error") }], ["write throws", { writeThrows: "Write unavailable" }],
  ],
  reactToDescription: [
    ["create with notification and push", {}], ["self reaction no notification", { selfReaction: true }], ["no notification no push", { noNotification: true }],
    ["normal HTML push retains legacy text", { descriptionContent: '  <p>Hello <strong>world</strong>&nbsp;&amp;</p><br><p>Next</p>\n' }],
    ["empty push retains legacy text", { descriptionContent: "" }],
    ["toggle existing", { existingReaction: true }], ["alreadyReacted true deletes", { existingReaction: true, body: { ...defaults.reactToDescription, alreadyReacted: true } }],
    ["alreadyReacted false with existing deletes", { existingReaction: true, body: { ...defaults.reactToDescription, alreadyReacted: false } }],
    ["no existing creates even alreadyReacted true", { body: { ...defaults.reactToDescription, alreadyReacted: true } }],
    ["forged actor", { body: { ...defaults.reactToDescription, userId: 6 }, expected: error(403, "Forbidden") }], ["confirmed actor", { body: { ...defaults.reactToDescription, userId: "985" } }],
    ["denied", { denied: true, expected: error(403, "Forbidden") }], ["missing description", { noDescription: true, expected: error(404, "Description not found") }],
    ["bad task", { body: { ...defaults.reactToDescription, taskId: 0 }, expected: error(400, "Missing required information") }],
    ["write failure", { writeThrows: "Write unavailable", expected: error(500, "Internal server error") }], ["notification failure after create", { notificationThrows: true, expected: error(500, "Internal server error") }],
  ],
  linkPullRequest: [
    ["new link 201", {}], ["existing link 200", { existingLink: true }], ["Better Auth cannot replace signed cookie", { noSigned: true, expected: error(401, "Unauthorized") }],
    ["signed cookie owns attribution", { signedUser: 2343 }], ["missing task", { body: {}, expected: error(400, "Bad request") }], ["bad task", { body: { taskId: 1.5, url: "x" }, expected: error(400, "Bad request") }],
    ["missing URL", { body: { taskId: 42 }, expected: error(400, "Pull request URL is required") }], ["typed link error", { writeThrows: "link", expected: { status: 422, body: { message: "Invalid pull request", code: "INVALID_URL" } } }],
    ["lease conflict", { writeThrows: "lease", expected: error(409, "Task lease conflict") }], ["realtime failure remains success", { realtimeThrows: true }], ["service failure", { writeThrows: "Service unavailable", expected: error(500, "Internal server error") }], ["signed verification throws", { signedThrows: true }],
  ],
};
for (const [label, descriptionContent, expectedText, legacyText = expectedText] of [
  ["normal HTML", '  <p>Hello <strong>world</strong>&nbsp;&amp;</p><br><p>Next</p>\n', '  Hello world&nbsp;&amp;Next\n'],
  ["nested script tag", '<scr<script>ipt>alert(1)</script>', 'iptalert(1)', 'ipt>alert(1)'],
  ["multiply nested script tag", '<scr<scr<script>ipt>ipt>alert(1)</script>', 'iptiptalert(1)', 'ipt>ipt>alert(1)'],
  ["unfinished script tag", '<script', 'script', '<script'],
  ["stray angle brackets", 'Note <> > <', 'Note   ', 'Note <> > <'],
  ["empty text", '', ''],
]) test(`reactToDescription: push text strips completely; ${label}`, async () => {
  const scenario = { descriptionContent };
  if (label === "normal HTML" || label === "empty text") assert.equal(expectedText, legacyText);
  else assert.match(legacyText, /[<>]/, "legacy regex is the vulnerable positive control");
  for (const mode of [false, "outage", true, "web"]) {
    const fx = fixture("reactToDescription", scenario, mode);
    assert.deepEqual(await invoke(fx, "reactToDescription", scenario, mode === "web" ? "web" : "current"), { status: 200, body: [{ id: 3 }] });
    const pushes = fx.effects.filter(([effect]) => effect === "push");
    assert.equal(pushes.length, 1);
    const text = pushes[0][1].notificationBody;
    assert.equal(text, mode === true || mode === "web" ? expectedText : legacyText);
    if (mode === true || mode === "web") assert.doesNotMatch(text, /[<>]/);
  }
});
scenarios.setRecurrence.push(...RECURRENCE_RULES.map(recurrence => [recurrence, { body: { taskId: 42, recurrence } }]));
scenarios.addRelations.push(...taskRelationTypes.map(relationType => [relationType, { body: { relations: { currentTaskId: "42", relatedTasks: [{ projectId: 16, uniqueIndex: 43, relationType }] } } }]));
for (const name of Object.keys(slice3Routes)) {
  const cases = [...scenarios[name], ["null body", { body: null }], ["undefined body", { body: undefined }], ["unauthenticated", { noAuth: true }], ["unauthenticated invalid body", { noAuth: true, body: {} }]];
  if (name !== "linkPullRequest") cases.push(["auth lookup throws", { authThrows: true }]);
  if (["setDueDate", "setStartDate", "setRecurrence", "addParent", "removeParent", "waiting-on"].includes(name)) cases.push(["actor lookup throws", { actorThrows: true }]);
  for (const [label, scenario] of cases) test(`${name}: ${label}; original / Off / outage / On / Web`, async () => {
    const log = { log: console.log, warn: console.warn, error: console.error };
    global.Date = FixedDate;
    console.log = console.warn = console.error = () => {};
    try {
      const original = fixture(name, scenario, false);
      const expected = await invoke(original, name, scenario, "legacy");
      if (scenario.expected) assert.deepEqual(expected, scenario.expected, "independent expected status/JSON");
      for (const mode of [false, "outage", true, "web"]) {
        const fx = fixture(name, scenario, mode);
        assert.deepEqual(await invoke(fx, name, scenario, mode === "web" ? "web" : "current"), expected, `${mode}: status/JSON`);
        assert.deepEqual(fx.effects, original.effects, `${mode}: queries/mutations/activity/queue/realtime/notifications in order`);
        if (mode !== "web") {
          assert.deepEqual(fx.flags, scenario.noAuth || scenario.authThrows ? [] : [["htpr-6923-app-router-writes", 985]], "signed preflight identity owns flag decision");
          assert.equal(fx.loads.length, mode === true && !scenario.noAuth && !scenario.authThrows ? 1 : 0, "Off/outage never load operation; On never retries");
          if (mode === true && !scenario.noAuth && !scenario.authThrows && name !== "linkPullRequest") assert.equal(fx.authCalls(), 1, "reuse authenticated dispatch session without legacy retry");
        }
      }
    } finally { global.Date = RealDate; Object.assign(console, log); }
  });
  test(`${name}: other methods bypass authentication and flag lookup`, async () => {
    for (const method of ["GET", "PUT", slice3Routes[name].method === "DELETE" ? "POST" : "DELETE"]) {
      const old = fixture(name, {}, false), current = fixture(name, {}, true);
      assert.deepEqual(await invoke(current, name, {}, "current", method), await invoke(old, name, {}, "legacy", method));
      assert.equal(current.authCalls(), 0);
      assert.deepEqual(current.flags, []);
      assert.deepEqual(current.loads, []);
    }
  });
}
