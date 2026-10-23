const test = require("node:test");
const assert = require("node:assert/strict");
const nextServer = require("next/server");
const { actor, loadTs } = require("./slack-app-fixtures.cjs");

const SECRET = "slack-client-secret";
const ORIGIN = "https://app.hypertask.ai";
const LEAK = "TEAMB-SECRET";

const actorA = actor;
const actorB = { ...actor, installId: "install-b", slackTeamId: "T2", slackUserId: "U1", teamId: "team-b", user: { id: 77, email: "other@example.com", displayName: "Other", photoURL: null } };

function matches(row, where) {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "AND") return expected.every((part) => matches(row, part));
    if (key === "OR") return expected.some((part) => matches(row, part));
    if (key === "member") return row.memberIds.includes(expected);
    const actual = row[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if ("equals" in expected) return String(actual).toLowerCase() === String(expected.equals).toLowerCase();
      if ("in" in expected) return expected.in.includes(actual);
      if ("not" in expected) return actual !== expected.not;
      if (actual && typeof actual === "object") return matches(actual, expected);
      throw new Error(`Unsupported where on ${key}`);
    }
    if (!(key in row)) throw new Error(`Unknown where field ${key}`);
    return actual === expected;
  });
}

const project = (id, teamId, title, memberIds, ownerId = memberIds[0]) => ({ id, teamId, title, uniqueIdentifier: teamId === "team-a" ? "AAA" : "BBB", status: "Normal", ownerId, memberIds, _count: { members: memberIds.length, tasks: 1 }, section: [{ id: id * 10, section_title: "Todo" }] });
const projectA = project(100, "team-a", "Alpha", [42, 43]);
const projectB = project(200, "team-b", "Beta", [77]);
const taskIn = (id, owner, title, number, index) => ({ id, projectId: owner.id, uniqueIndex: index, ticketNumber: number, title, userId: 42, sectionId: 1, section: "Todo", status: "Normal", project: owner });
const taskA = taskIn(10, projectA, "Alpha task", "AAA-1", 1);
const taskB = taskIn(20, projectB, `${LEAK} task`, "BBB-1", 1);

function actionsFixture() {
  const calls = [], scopes = [];
  const record = (name) => async (...args) => { calls.push({ name, args }); return { status: 200, json: {}, body: {} }; };
  const defaultMock = (fn) => ({ __esModule: true, default: fn });
  const projects = [projectA, projectB], tasks = [taskA, taskB];
  const scoped = (rows, where) => { scopes.push(where); return rows.filter((row) => matches(row, where)); };
  const links = { "install-a:U1": actorA.user, "install-a:U2": { id: 99, email: "nonmember@example.com", displayName: "Non", photoURL: null }, "install-a:U3": { id: 43, email: "member@example.com", displayName: "Member", photoURL: null }, "install-b:U1": actorB.user };
  const loaded = loadTs("src/lib/slack/actions.ts", {
    "@/lib/constants/constants": { PriorityConstants: [] },
    "@/lib/slack/projectScope": { slackAccessibleProjectWhere: (teamId, userId) => ({ AND: [{ teamId, status: "Normal" }, { member: userId }] }) },
    "@/lib/mcp/tasks/mappers": { taskMcpGetInclude: () => ({}), mapTaskToMcpGetResponse: (row) => ({ ...row, boardTitle: row.project.title, totalComments: 0 }) },
    "@/lib/mcp/tasks/services": { resolveLabelIds: async () => [], setTaskLabels: record("labels") },
    "@/lib/prisma": { __esModule: true, default: {
      project: {
        findFirst: async ({ where }) => scoped(projects, where)[0] ?? null,
        findMany: async ({ where }) => scoped(projects, where),
        findUnique: async ({ where }) => { const found = projects.find((item) => item.id === where.id); return found ? { ownerId: found.ownerId, members: found.memberIds.map((userId) => ({ userId })) } : null; },
      },
      task: {
        findFirst: async ({ where }) => scoped(tasks, where)[0] ?? null,
        findMany: async ({ where }) => scoped(tasks, where),
        count: async ({ where }) => scoped(tasks, where).length,
      },
      section: { findFirst: async () => ({ id: 1, section_title: "Todo" }), findMany: async () => [] },
      slackUserLink: { findUnique: async ({ where }) => { const { installId, slackUserId } = where.installId_slackUserId; const user = links[`${installId}:${slackUserId}`]; return user ? { user } : null; } },
      user: { findMany: async () => [] },
      notification: { findFirst: async ({ where }) => { scopes.push(where); return where.id === 8 ? { id: 8, taskId: 10 } : null; }, updateMany: record("siblings"), update: record("archive") },
    } },
    "@/lib/realtime/server": Object.fromEntries(["broadcastBoardChange", "broadcastInboxChange", "broadcastTaskChange", "broadcastTaskComment"].map((name) => [name, record(name)])),
    "@/pages/api/queues/duedateQueue": { cancelDueDateJob: record("cancel-due"), scheduleDueDateJob: record("schedule-due") },
    "@/pages/api/queues/FAST/generateSummary": defaultMock(record("summary")),
    "@/utils/controllers/activities/createArchiveActivity": defaultMock(record("archive-activity")),
    "@/utils/controllers/activities/CreatePriorityActivity": defaultMock(record("priority-activity")),
    "@/utils/controllers/activities/createTaskDueDateActivity": defaultMock(record("due-activity")),
    "@/utils/controllers/assignees/assign": defaultMock(record("assign")),
    "@/utils/controllers/comments/createCommentService": { createCommentService: record("comment") },
    "@/utils/controllers/followers/createFollowerService": { createFollowerService: record("follower") },
    "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove": defaultMock(record("notify")),
    "@/utils/controllers/notifications/broadcastInboxForTask": { broadcastInboxForTask: record("inbox") },
    "@/utils/controllers/notifications/getAll": defaultMock(async () => ({ status: 200, json: { notifications: [
      { id: 8, task: taskA, project: { teamId: "team-a", title: "Alpha" } },
      { id: 9, task: taskB, project: { teamId: "team-b", title: LEAK } },
    ] } })),
    "@/utils/controllers/search/document": { turbopufferSearchTaskIds: async () => [10, 20] },
    "@/utils/controllers/tasks/createTaskCore": { createTaskCore: async (input) => { calls.push({ name: "create", args: [input] }); return { task: { ...taskA, id: 11, projectId: input.projectId } }; } },
    "@/utils/controllers/tasks/single": { updateTaskSingle: record("update") },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { upsertTaskToTurbopuffer: record("index") },
    "@/utils/controllers/urls/extractUrlsFromContent": { persistUrlsForComment: record("urls") },
    "@/utils/helperFunctions/markdownToHtml": { markdownToHtml: (value) => value },
    "@/utils/helperFunctions/sanitizeRichHtml": { sanitizeRichHtml: (value) => value },
    "@/utils/generateRank": defaultMock(() => "rank"),
  });
  return { ...loaded, calls, scopes };
}

test("create --project with a team B project id is not found for a team A actor and writes nothing", async () => {
  const { executeSlackAction, calls, scopes } = actionsFixture();
  const refused = await executeSlackAction(actorA, { action: "create_task", params: { title: "Leak", project: String(projectB.id) } });
  assert.match(JSON.stringify(refused), /not found/);
  assert.equal(calls.filter((call) => call.name === "create").length, 0);
  assert.ok(scopes.some((where) => JSON.stringify(where).includes('"team-a"')));
  assert.ok(scopes.every((where) => !JSON.stringify(where).includes('"team-b"')));
});

test("create --project by team B project title is not found for a team A actor", async () => {
  const { executeSlackAction, calls } = actionsFixture();
  const refused = await executeSlackAction(actorA, { action: "create_task", params: { title: "Leak", project: "Beta" } });
  assert.match(JSON.stringify(refused), /not found/);
  assert.equal(calls.filter((call) => call.name === "create").length, 0);
});

test("still allowed: create --project with a team A project the actor belongs to creates in that project", async () => {
  const { executeSlackAction, calls } = actionsFixture();
  await executeSlackAction(actorA, { action: "create_task", params: { title: "Mine", project: String(projectA.id) } });
  const created = calls.filter((call) => call.name === "create");
  assert.equal(created.length, 1);
  assert.equal(created[0].args[0].projectId, projectA.id);
  assert.equal(created[0].args[0].userId, actorA.user.id);
});

test("a team A project the actor is not a member of is also not found", async () => {
  const { executeSlackAction, calls } = actionsFixture();
  const refused = await executeSlackAction({ ...actorA, user: { ...actorA.user, id: 500 } }, { action: "create_task", params: { title: "Nope", project: String(projectA.id) } });
  assert.match(JSON.stringify(refused), /not found/);
  assert.equal(calls.filter((call) => call.name === "create").length, 0);
});

test("view by ticket number and by bare number never returns team B data", async () => {
  const { executeSlackAction, scopes } = actionsFixture();
  for (const ticket of ["BBB-1", "bbb-1"]) {
    const result = await executeSlackAction(actorA, { action: "get_task", params: { ticket } });
    assert.match(JSON.stringify(result), /not found/);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(LEAK));
  }
  const byNumber = await executeSlackAction(actorA, { action: "get_task", params: { ticket: "1" } });
  assert.match(JSON.stringify(byNumber), /Alpha task/);
  assert.doesNotMatch(JSON.stringify(byNumber), new RegExp(LEAK));
  assert.ok(scopes.every((where) => JSON.stringify(where).includes('"team-a"')));
});

test("still allowed: team A ticket and team B ticket each resolve only for their own team", async () => {
  const { executeSlackAction } = actionsFixture();
  assert.match(JSON.stringify(await executeSlackAction(actorA, { action: "get_task", params: { ticket: "AAA-1" } })), /Alpha task/);
  assert.match(JSON.stringify(await executeSlackAction(actorB, { action: "get_task", params: { ticket: "BBB-1" } })), new RegExp(LEAK));
  assert.match(JSON.stringify(await executeSlackAction(actorB, { action: "get_task", params: { ticket: "AAA-1" } })), /not found/);
});

test("list, projects and sections are scoped to the actor's team and membership", async () => {
  const { executeSlackAction, scopes } = actionsFixture();
  const listed = JSON.stringify(await executeSlackAction(actorA, { action: "list_tasks", params: {} }));
  assert.match(listed, /Alpha task/);
  assert.doesNotMatch(listed, new RegExp(LEAK));
  const projectsShown = JSON.stringify(await executeSlackAction(actorA, { action: "list_projects", params: {} }));
  assert.match(projectsShown, /Alpha/);
  assert.doesNotMatch(projectsShown, /Beta/);
  assert.match(JSON.stringify(await executeSlackAction(actorA, { action: "list_sections", params: { project: "200" } })), /not found/);
  for (const where of scopes) {
    assert.match(JSON.stringify(where), /"team-a"/);
    assert.match(JSON.stringify(where), /"member":42|"userId":42/);
  }
});

test("list --project of a team B project is not found for team A", async () => {
  const { executeSlackAction } = actionsFixture();
  assert.match(JSON.stringify(await executeSlackAction(actorA, { action: "list_tasks", params: { project: "Beta" } })), /not found/);
});

test("search never returns team B tasks even when the search index returns their ids", async () => {
  const { executeSlackAction } = actionsFixture();
  const result = JSON.stringify(await executeSlackAction(actorA, { action: "search_tasks", params: { query: "task" } }));
  assert.match(result, /Alpha task/);
  assert.doesNotMatch(result, new RegExp(LEAK));
  const asB = JSON.stringify(await executeSlackAction(actorB, { action: "search_tasks", params: { query: "task" } }));
  assert.match(asB, new RegExp(LEAK));
  assert.doesNotMatch(asB, /Alpha task/);
});

test("inbox lists only the actor's team and archive refuses a notification outside it", async () => {
  const { executeSlackAction, calls, scopes } = actionsFixture();
  const inbox = JSON.stringify(await executeSlackAction(actorA, { action: "list_inbox", params: {} }));
  assert.match(inbox, /Alpha task/);
  assert.doesNotMatch(inbox, new RegExp(LEAK));
  const refused = await executeSlackAction(actorA, { action: "archive_inbox", params: { notificationId: "9" } });
  assert.match(JSON.stringify(refused), /not found or access denied/);
  assert.equal(calls.filter((call) => call.name === "archive").length, 0);
  const archiveScope = scopes.find((where) => where.id === 9);
  assert.equal(archiveScope.userId, actorA.user.id);
  assert.match(JSON.stringify(archiveScope.project), /"team-a"/);
  const allowed = await executeSlackAction(actorA, { action: "archive_inbox", params: { notificationId: "8" } });
  assert.match(JSON.stringify(allowed), /archived/);
  assert.equal(calls.filter((call) => call.name === "archive").length, 1);
});

test("assign to a Slack user linked to a non-member of the project assigns nobody", async () => {
  const { executeSlackAction, calls } = actionsFixture();
  const refused = await executeSlackAction(actorA, { action: "assign_user", params: { ticket: "AAA-1", username: "<@U2>" } });
  assert.match(JSON.stringify(refused), /was not found/);
  assert.equal(calls.filter((call) => call.name === "assign").length, 0);
});

test("still allowed: assign to a Slack user linked to a project member assigns them", async () => {
  const { executeSlackAction, calls } = actionsFixture();
  const done = await executeSlackAction(actorA, { action: "assign_user", params: { ticket: "AAA-1", username: "<@U3>" } });
  assert.match(JSON.stringify(done), /Assigned/);
  const assigned = calls.filter((call) => call.name === "assign");
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].args[1], 43);
});

test("assign resolves Slack mentions only inside the actor's own install", async () => {
  const { executeSlackAction, calls } = actionsFixture();
  await executeSlackAction(actorA, { action: "assign_user", params: { ticket: "AAA-1", username: "<@U1>" } });
  assert.equal(calls.filter((call) => call.name === "assign").at(-1).args[1], actorA.user.id);
  await executeSlackAction(actorB, { action: "assign_user", params: { ticket: "BBB-1", username: "<@U1>" } });
  assert.equal(calls.filter((call) => call.name === "assign").at(-1).args[1], actorB.user.id);
  assert.equal(calls.filter((call) => call.name === "assign").length, 2);
});

test("project scope always carries the install team beside the user's access", () => {
  const { slackAccessibleProjectWhere } = loadTs("src/lib/slack/projectScope.ts", {
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: (userId) => ({ teamId: { not: null }, access: userId }) },
  });
  const where = slackAccessibleProjectWhere("team-a", 42);
  assert.deepEqual(where.AND[0], { status: "Normal", teamId: "team-a" });
  assert.deepEqual(where.AND[1].access, 42);
  assert.notDeepEqual(slackAccessibleProjectWhere("team-b", 42).AND[0], where.AND[0]);
});

function userLinkFixture() {
  const members = { "install-a": [42, 43], "install-b": [77] };
  const installs = {
    T1: { id: "install-a", teamId: "team-a", links: { U1: { id: 42, email: "a@example.com", displayName: "A", photoURL: null } } },
    T2: { id: "install-b", teamId: "team-b", links: { U1: { id: 77, email: "b@example.com", displayName: "B", photoURL: null } } },
  };
  const deleted = [];
  const prisma = {
    slackInstall: {
      findUnique: async ({ where }) => {
        const found = installs[where.slackTeamId];
        if (!found) return null;
        const link = found.links.U1;
        return { id: found.id, teamId: found.teamId, slackTeamId: where.slackTeamId, encryptedBotToken: `cipher-${found.id}`, installedByUserId: 6, team: { aiProviderSettings: {} }, userLinks: link ? [{ user: link }] : [] };
      },
      findFirst: async ({ where }) => (members[where.id].includes(where.team.OR[0].googleAccount.is.userId) ? { id: where.id } : null),
    },
    slackUserLink: { deleteMany: async ({ where }) => { deleted.push(where); } },
    team: { findUnique: async () => ({ googleAccount: { userId: 6 }, members: [] }) },
    user: { findUnique: async () => null },
  };
  const loaded = loadTs("src/lib/slack/userLink.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/crypto/byokCipher": { decryptSecret: (cipher) => `token-for-${cipher}` },
    "@/lib/redis": { getRedis: async () => ({ get: async () => null }) },
    "@/lib/flags": { HTPR_6817_SLACK_APP_FLAG: "flag", isFeatureEnabled: async () => true },
    "@/lib/slack/api": { callSlackApi: async () => ({ ok: true, user: { is_email_confirmed: false } }) },
  });
  return { ...loaded, installs, members, deleted };
}

test("the same Slack user id in two workspaces resolves to different users, installs, teams and bot tokens", async () => {
  const { resolveSlackActor } = userLinkFixture();
  const inA = await resolveSlackActor("T1", "U1");
  const inB = await resolveSlackActor("T2", "U1");
  assert.deepEqual([inA.user.id, inA.installId, inA.teamId, inA.botToken], [42, "install-a", "team-a", "token-for-cipher-install-a"]);
  assert.deepEqual([inB.user.id, inB.installId, inB.teamId, inB.botToken], [77, "install-b", "team-b", "token-for-cipher-install-b"]);
  assert.equal(await resolveSlackActor("T3", "U1"), null);
});

test("a link pointing at a user outside the install's team is dropped, not honored", async () => {
  const fixture = userLinkFixture();
  fixture.installs.T2.links.U1 = { id: 42, email: "a@example.com", displayName: "A", photoURL: null };
  assert.equal(await fixture.resolveSlackActor("T2", "U1"), null);
  assert.deepEqual(fixture.deleted, [{ installId: "install-b", slackUserId: "U1" }]);
  assert.equal((await fixture.resolveSlackActor("T1", "U1")).user.id, 42);
});

function oauthFixture(boundWorkspaces) {
  const oauthState = loadTs("src/lib/slack/oauthState.ts");
  const writes = [];
  const prisma = {
    slackInstall: {
      findUnique: async ({ where }) => {
        if (where.slackTeamId) { const teamId = boundWorkspaces[where.slackTeamId]; return teamId ? { teamId } : null; }
        const slackTeamId = Object.keys(boundWorkspaces).find((key) => boundWorkspaces[key] === where.teamId);
        return slackTeamId ? { slackTeamId } : null;
      },
      upsert: async (args) => { writes.push({ upsert: args }); return {}; },
      delete: async () => { writes.push("delete"); },
      create: async () => { writes.push("create"); },
    },
    $transaction: async () => { writes.push("transaction"); },
  };
  const route = loadTs("src/app/api/slack/oauth_redirect/route.ts", {
    "next/server": nextServer,
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/auth/requestBaseUrl": { getRequestBaseUrl: () => ORIGIN },
    "@/lib/auth/serverUser": { getServerCookieUser: async () => ({ id: 42 }) },
    "@/lib/auth/safeReturnTo": { SLACK_SETTINGS_PATH: "/settings/slack" },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/crypto/byokCipher": { encryptSecret: (value) => `enc:${value.length}` },
    "@/lib/flags/keys": { HTPR_4857_ADD_TO_SLACK_FLAG: "flag" },
    "@/utils/controllers/teams/hasTeamMembershipAccess": { hasTeamMembershipAccess: async () => true },
  });
  async function connect(teamId, slackTeamId) {
    const saved = { id: process.env.SLACK_CLIENT_ID, secret: process.env.SLACK_CLIENT_SECRET, fetch: global.fetch };
    process.env.SLACK_CLIENT_ID = "client-id";
    process.env.SLACK_CLIENT_SECRET = SECRET;
    global.fetch = async () => ({ ok: true, json: async () => ({ ok: true, access_token: "xoxb-test", bot_user_id: "B1", team: { id: slackTeamId, name: "Workspace" } }) });
    try {
      const nonce = oauthState.newSlackInstallNonce();
      const state = oauthState.createSlackOAuthState({ nonce, teamId, userId: 42 }, SECRET);
      const request = new nextServer.NextRequest(`${ORIGIN}/api/slack/oauth_redirect?code=c&state=${encodeURIComponent(state)}`, { headers: { cookie: `${oauthState.SLACK_OAUTH_ATTEMPT_COOKIE}=${nonce}` } });
      return new URL((await route.GET(request)).headers.get("location")).searchParams;
    } finally {
      process.env.SLACK_CLIENT_ID = saved.id;
      process.env.SLACK_CLIENT_SECRET = saved.secret;
      global.fetch = saved.fetch;
    }
  }
  return { connect, writes };
}

test("a workspace already bound to team A cannot be bound to team B", async () => {
  const { connect, writes } = oauthFixture({ T1: "team-a" });
  const outcome = await connect("team-b", "T1");
  assert.equal(outcome.get("slack_error"), "workspace_already_connected");
  assert.equal(outcome.get("slack_success"), null);
  assert.deepEqual(writes, []);
});

test("still allowed: the owning team reconnects its workspace and team B binds a free workspace", async () => {
  const same = oauthFixture({ T1: "team-a" });
  assert.equal((await same.connect("team-a", "T1")).get("slack_success"), "connected");
  assert.equal(same.writes[0].upsert.where.teamId, "team-a");
  const free = oauthFixture({ T1: "team-a" });
  assert.equal((await free.connect("team-b", "T2")).get("slack_success"), "connected");
  assert.equal(free.writes[0].upsert.where.teamId, "team-b");
});

function threadFixture(installs, projects, linked = actorA.user) {
  const replies = [], created = [], watched = [], projectScopes = [];
  const loaded = loadTs("src/lib/slack/taskCreate.ts", {
    "@/lib/net/downloadWithoutBrotli": { downloadWithoutBrotli: () => null },
    "@/app/api/ai/_lib/modelProvider": { resolveAiModel: () => ({}), configureAiModelUsage: () => {}, providerOptionsForAiModel: () => ({}), aiUsageProviderForCredential: () => "gateway" },
    "@/app/api/ai/_lib/byokKeys": { getAiDefaultModelContext: async () => ({ haiku55Enabled: false }), resolveAutomaticAiModel: () => ({}), getTeamGatewayApiKey: async () => "key" },
    ai: { generateText: async () => ({ output: { title: "Title", ask: "Do it", contextBullets: ["c"], technicalDetails: [] } }), Output: { object: () => ({}) } },
    "@/lib/crypto/byokCipher": { decryptSecret: (cipher) => `token-${cipher}` },
    "@/lib/mcp/tasks/services": { createTask: async (input) => { created.push(input); return { id: 900, projectId: input.projectId, uniqueIndex: 5 }; } },
    "@/lib/mcp-server/utils/task-link": { buildTaskLink: (projectId, index) => `${ORIGIN}/detail/project-${projectId}/${index}` },
    "@/lib/prisma": { __esModule: true, default: {
      slackInstall: { findUnique: async ({ where }) => installs[where.slackTeamId] ?? null },
      project: { findFirst: async ({ where }) => { projectScopes.push(where); return projects.filter((item) => matches(item, where))[0] ?? null; } },
      slackWatchedThread: { findUnique: async () => null, upsert: async (args) => { watched.push(args); } },
    } },
    "@/lib/slack/api": { postSlackThreadReply: async (token, channel, ts, text) => { replies.push({ token, text }); } },
    "@/lib/slack/rateLimit": { claimSlackActionCapacity: async () => true },
    "@/lib/slack/threadSummary": { loadSlackThreadSource: async () => ({ transcript: "user: please file this", permalink: "https://slack.example/p1", lastMessageTs: "1.5" }) },
    "@/lib/slack/userLink": { resolveSlackActor: async (slackTeamId) => (slackTeamId === "T1" ? { ...actorA, user: linked } : { ...actorB }) },
    "@/lib/systemModelLadder": { resolveSystemModel: () => ({ model: "anthropic/claude-haiku-5.5", provider: "gateway" }) },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: (userId) => ({ member: userId }) },
  });
  return { ...loaded, replies, created, watched, projectScopes };
}

const installs = {
  T1: { id: "install-a", teamId: "team-a", defaultProjectId: 100, encryptedBotToken: "cipher-a", team: { aiProviderSettings: {} } },
  T2: { id: "install-b", teamId: "team-b", defaultProjectId: 200, encryptedBotToken: "cipher-b", team: { aiProviderSettings: {} } },
};
const mention = (slackTeamId) => ({ channelId: "C1", slackTeamId, slackUserId: "U1", threadTs: "1.0" });

test("a thread-to-ticket mention from workspace A creates only in team A's default project", async () => {
  const fixture = threadFixture(installs, [projectA, projectB]);
  await fixture.createSlackTaskFromThread(mention("T1"));
  assert.equal(fixture.created.length, 1);
  assert.equal(fixture.created[0].projectId, projectA.id);
  assert.equal(fixture.created[0].teamId, "team-a");
  assert.equal(fixture.created[0].userId, actorA.user.id);
  assert.ok(fixture.projectScopes.every((where) => JSON.stringify(where).includes('"teamId":"team-a"')));
  assert.equal(fixture.watched[0].create.installId, "install-a");
  assert.deepEqual(fixture.watched[0].create.matchedTaskIds, [900]);
  assert.equal(fixture.replies[0].token, "token-cipher-a");
});

test("still allowed: workspace B creates in its own default project with its own user", async () => {
  const fixture = threadFixture(installs, [projectA, projectB]);
  await fixture.createSlackTaskFromThread(mention("T2"));
  assert.equal(fixture.created[0].projectId, projectB.id);
  assert.equal(fixture.created[0].teamId, "team-b");
  assert.equal(fixture.created[0].userId, actorB.user.id);
  assert.equal(fixture.watched[0].create.installId, "install-b");
});

test("a default project that belongs to another team is refused and nothing is created", async () => {
  const crossed = { ...installs, T1: { ...installs.T1, defaultProjectId: projectB.id } };
  const fixture = threadFixture(crossed, [projectA, projectB]);
  await fixture.createSlackTaskFromThread(mention("T1"));
  assert.equal(fixture.created.length, 0);
  assert.equal(fixture.watched.length, 0);
  assert.match(fixture.replies[0].text, /default project is unavailable/);
  assert.deepEqual(fixture.projectScopes[0].AND[0], { id: projectB.id, status: "Normal", teamId: "team-a" });
});

test("a default project the linked user cannot access is refused", async () => {
  const fixture = threadFixture(installs, [projectA, projectB], { ...actorA.user, id: 500 });
  await fixture.createSlackTaskFromThread(mention("T1"));
  assert.equal(fixture.created.length, 0);
  assert.match(fixture.replies[0].text, /default project is unavailable/);
});

function eventsFixture() {
  const work = [], watched = [], taskScopes = [];
  const slackInstalls = { T1: { id: "install-a", teamId: "team-a" }, T2: { id: "install-b", teamId: "team-b" } };
  const tasks = [
    { id: 10, ticketNumber: "AAA-1", projectId: 100, uniqueIndex: 1, status: "Normal", project: { teamId: "team-a" } },
    { id: 20, ticketNumber: "BBB-1", projectId: 200, uniqueIndex: 1, status: "Normal", project: { teamId: "team-b" } },
  ];
  const { POST } = loadTs("src/app/api/slack/events/route.ts", {
    "@vercel/functions": { waitUntil: (promise) => work.push(promise) },
    "@/lib/slack/signature": { verifySlackSignature: () => true },
    "@/lib/slack/uninstall": {},
    "@/lib/prisma": { __esModule: true, default: {
      slackInstall: { findUnique: async ({ where }) => slackInstalls[where.slackTeamId] ?? null },
      slackWatchedThread: { findUnique: async () => null, upsert: async (input) => watched.push(input) },
      task: { findMany: async ({ where }) => {
        taskScopes.push(where);
        const wanted = where.OR.flatMap((clause) => (clause.ticketNumber ? clause.ticketNumber.in.map((ticketNumber) => ({ ticketNumber })) : [clause]));
        return tasks.filter((task) => wanted.some((clause) => Object.entries(clause).every(([key, value]) => task[key] === value)) && task.project.teamId === where.project.teamId);
      } },
    } },
  });
  async function send(slackTeamId, text) {
    const body = { type: "event_callback", event_id: `Ev-${Math.random()}`, team_id: slackTeamId, event: { type: "message", channel_type: "channel", channel: "C1", user: "U1", ts: "1.0", text } };
    const response = await POST(new Request(`${ORIGIN}/api/slack/events`, { method: "POST", body: JSON.stringify(body) }));
    assert.equal(response.status, 200);
    await Promise.all(work.splice(0));
  }
  return { send, watched, taskScopes };
}

test("a message in workspace A that references a team B ticket or URL starts no watched thread", async () => {
  const fixture = eventsFixture();
  await fixture.send("T1", "see BBB-1");
  await fixture.send("T1", `see ${ORIGIN}/detail/project-200/1`);
  assert.equal(fixture.watched.length, 0);
  assert.ok(fixture.taskScopes.every((where) => where.project.teamId === "team-a"));
});

test("a mixed message watches only the team A ticket", async () => {
  const fixture = eventsFixture();
  await fixture.send("T1", `AAA-1 and BBB-1 and ${ORIGIN}/detail/project-200/1`);
  assert.equal(fixture.watched.length, 1);
  assert.deepEqual(fixture.watched[0].create.matchedTaskIds, [10]);
  assert.equal(fixture.watched[0].create.installId, "install-a");
});

test("still allowed: workspace B watches its own ticket and URL", async () => {
  const fixture = eventsFixture();
  await fixture.send("T2", `see BBB-1 ${ORIGIN}/detail/project-200/1`);
  assert.deepEqual(fixture.watched[0].create.matchedTaskIds, [20]);
  assert.equal(fixture.watched[0].create.installId, "install-b");
});

test("filterSlackTaskIdsForTeam drops tasks of other teams even if the query leaked them", () => {
  const { filterSlackTaskIdsForTeam } = loadTs("src/lib/slack/references.ts");
  const rows = [{ id: 10, project: { teamId: "team-a" } }, { id: 20, project: { teamId: "team-b" } }, { id: 30, project: { teamId: null } }];
  assert.deepEqual(filterSlackTaskIdsForTeam(rows, "team-a"), [10]);
  assert.deepEqual(filterSlackTaskIdsForTeam(rows, "team-b"), [20]);
});
