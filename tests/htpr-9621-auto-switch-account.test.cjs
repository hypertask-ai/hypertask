const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const BOARD = { id: 15, ownerId: 2, members: [3] };
const TASK = { id: 42, uniqueIndex: 9621, projectId: 15, title: "Quarterly plan" };
const WRONG = 1;
const OWNER = 2;
const MEMBER = 3;
const STRANGER = 4;
const OWNER_TOKEN = "owner-session";
const MEMBER_TOKEN = "member-session";
const STRANGER_TOKEN = "stranger-session";
const FORGED_TOKEN = "forged-session";

function allows(where) {
  if (!where || where.uniqueIndex !== TASK.uniqueIndex) return false;
  if (where.status?.not !== "Deleted") return false;
  const project = where.project;
  if (!project || project.id !== BOARD.id || project.status?.not !== "Deleted") return false;
  if (!Array.isArray(project.OR)) return false;
  return project.OR.some((branch) => {
    if (branch.ownerId === BOARD.ownerId) return true;
    const some = branch.members?.some;
    return Boolean(some && some.agentId === null && BOARD.members.includes(some.userId));
  });
}

function userIdFromWhere(where) {
  const branches = where?.project?.OR ?? [];
  const owner = branches.find((branch) => typeof branch.ownerId === "number");
  return owner?.ownerId ?? branches.find((branch) => branch.members?.some)?.members.some.userId ?? null;
}

function harness() {
  const state = {
    enabled: true,
    userId: WRONG,
    sessions: [],
    activated: [],
    lookups: [],
    listed: 0,
  };
  const prisma = {
    task: {
      findFirst: async ({ where, select }) => {
        state.lookups.push({ where, select, userId: userIdFromWhere(where) });
        if (!select || Object.keys(select).join() !== "id" || select.id !== true) {
          return { id: TASK.id, title: TASK.title };
        }
        return allows(where) ? { id: TASK.id } : null;
      },
    },
  };
  const auth = {
    api: {
      listDeviceSessions: async () => {
        state.listed += 1;
        return state.sessions;
      },
      setActiveSession: async ({ body }) => {
        state.activated.push(body.sessionToken);
        return new Response(null, {
          status: 200,
          headers: { "set-cookie": `better-auth.session_token=${body.sessionToken}; Path=/` },
        });
      },
    },
  };
  const mocks = {
    "next/server": {
      NextResponse: {
        json: (body, init) => Response.json(body, { headers: init?.headers }),
      },
    },
    "@/lib/auth/serverUser": {
      getServerCookieUser: async () => (state.userId == null ? null : { id: state.userId }),
    },
    "@/lib/flags": {
      isFeatureEnabled: async () => state.enabled,
    },
    "@/lib/flags/definitions/htpr-9621-auto-switch-account": {
      HTPR_9621_AUTO_SWITCH_ACCOUNT_FLAG: "htpr-9621-auto-switch-account",
    },
    "@/lib/flags/keys": { HTPR_6868_TICKET_PREFIX_FLAG: "htpr-6868-ticket-prefix" },
    "@/lib/flags/definitions/htpr-7339-agent-pulse-dot": {
      HTPR_7339_AGENT_PULSE_DOT_FLAG: "htpr-7339-agent-pulse-dot",
    },
    "@/lib/auth/betterAuth": { auth },
    "@/lib/prisma": { default: prisma },
    "@prisma/client": {
      Status: { Deleted: "Deleted", Normal: "Normal", Archive: "Archive" },
      ViewVisibility: { Public: "Public", Private: "Private" },
      Prisma: { sql: () => ({}), join: () => ({}), raw: () => ({}), empty: {} },
      PrismaClient: class {},
    },
    "@/lib/auth/agentScope": { agentScopeEnforced: () => true },
    "@/lib/tasks/sameBoardRelations": { stripForeignTaskRelations: (task) => task },
    "@vercel/functions": { waitUntil: () => {} },
    "@/lib/realtime/server": { broadcastTaskChange: async () => {} },
    "@/lib/mcp/tasks/resolveTask": {
      findTaskByIdentifier: async () => null,
      TaskIdentifierAmbiguityError: class TaskIdentifierAmbiguityError extends Error {},
    },
    "@/lib/cycles": { CYCLE_WINDOW_SIZE: 2 },
    "@/lib/pullRequests/taskPullRequests": { refreshTaskPullRequests: async () => [] },
    "@/lib/agents/publicAgent": {
      publicAgentSelect: {},
      projectPublicAgent: () => null,
      sanitizeAgentCredentials: (value) => value,
    },
    "@/lib/agents/visibility": {
      accessibleAgentMembershipWhere: () => ({}),
      boardAgentVisibilityWhere: () => ({}),
      isAgentVisibleToUser: () => false,
    },
    "@/utils/controllers/notifications/visibleInboxScope": { visibleUserInboxWhere: () => ({}) },
    "@/lib/tasks/waitingOnActivitySql": { visibleWaitingOnActivity: {} },
    "@/lib/tasks/redactWaitingActivities": { scrubStoredTaskSummary: async (content) => content },
    "@/utils/controllers/tasks/attachAgentStatus": {
      attachAgentStatus: async (rows) => rows.map((row) => ({ ...row, agentStatus: null })),
    },
  };
  const previous = process.env.BETTER_AUTH_ENABLED;
  process.env.BETTER_AUTH_ENABLED = "1";
  const route = load("src/app/api/auth/ticket-account-switch/route.ts", mocks);
  const access = load("src/lib/auth/ticketAccountSwitch.ts", mocks);
  const detail = load("src/utils/controllers/taskDetail/load.ts", mocks);
  return {
    state,
    route: route.POST,
    openTicketForAccount: access.openTicketForAccount,
    taskWhere: detail.taskWhere,
    parseDetailSlug: detail.parseDetailSlug,
    restore() {
      if (previous === undefined) delete process.env.BETTER_AUTH_ENABLED;
      else process.env.BETTER_AUTH_ENABLED = previous;
    },
  };
}

function request(body) {
  return new Request("https://app.hypertask.ai/api/auth/ticket-account-switch", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "better-auth.session_token=active" },
    body: JSON.stringify(body),
  });
}

const ticketBody = {
  projectSlug: "project-15",
  uniqueIndex: "9621",
  userId: OWNER,
  sessionToken: FORGED_TOKEN,
  accounts: [{ userId: OWNER, sessionToken: FORGED_TOKEN }],
  title: TASK.title,
};

test("refuses a ticket the signed-in account cannot open", async () => {
  const app = harness();
  try {
    app.state.sessions = [
      { user: { id: STRANGER, email: "stranger@example.com" }, session: { token: STRANGER_TOKEN } },
      { user: { id: OWNER, email: "owner@example.com" }, session: { token: OWNER_TOKEN } },
    ];
    const refused = await app.openTicketForAccount(WRONG, "project-15", "9621");
    assert.equal(refused, null);
    const stranger = await app.openTicketForAccount(STRANGER, "project-15", "9621");
    assert.equal(stranger, null);
    const response = await app.route(request(ticketBody));
    const body = await response.json();
    assert.deepEqual(body, { action: "switch" });
    assert.deepEqual(app.state.activated, [OWNER_TOKEN]);
    assert.equal(JSON.stringify(body).includes(TASK.title), false);
    assert.equal(JSON.stringify(body).includes(OWNER_TOKEN), false);
    assert.equal(JSON.stringify(body).includes("owner@example.com"), false);
    assert.equal(String(body.id), "undefined");
    const slug = app.parseDetailSlug(["project-15", "9621"]);
    const wrongLookup = app.state.lookups.find((lookup) => lookup.userId === WRONG);
    assert.ok(wrongLookup);
    assert.deepEqual(wrongLookup.where, app.taskWhere(slug, WRONG));
    assert.deepEqual(wrongLookup.select, { id: true });
  } finally {
    app.restore();
  }
});

test("the account that can open the ticket still opens it through the same check", async () => {
  const app = harness();
  try {
    const opened = await app.openTicketForAccount(OWNER, "project-15", "9621");
    assert.deepEqual(opened, { id: TASK.id });
    const member = await app.openTicketForAccount(MEMBER, "project-15", "9621");
    assert.deepEqual(member, { id: TASK.id });
    const slug = app.parseDetailSlug(["project-15", "9621"]);
    assert.deepEqual(
      app.state.lookups.find((lookup) => lookup.userId === OWNER).where,
      app.taskWhere(slug, OWNER),
    );
    assert.deepEqual(
      app.state.lookups.find((lookup) => lookup.userId === MEMBER).where,
      app.taskWhere(slug, MEMBER),
    );

    app.state.userId = WRONG;
    app.state.sessions = [
      { user: { id: String(OWNER), email: "owner@example.com" }, session: { token: OWNER_TOKEN } },
    ];
    app.state.lookups.length = 0;
    const response = await app.route(request(ticketBody));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { action: "switch" });
    assert.deepEqual(app.state.activated, [OWNER_TOKEN]);
    assert.equal(response.headers.get("set-cookie")?.includes(OWNER_TOKEN), true);
    const switched = app.state.lookups.find((lookup) => lookup.userId === OWNER);
    assert.ok(switched);
    assert.deepEqual(switched.where, app.taskWhere(slug, OWNER));
    assert.equal(allows(switched.where), true);

    app.state.userId = OWNER;
    app.state.sessions = [
      { user: { id: STRANGER }, session: { token: STRANGER_TOKEN } },
    ];
    app.state.activated.length = 0;
    const alreadyOpen = await app.route(request(ticketBody));
    assert.deepEqual(await alreadyOpen.json(), { action: "stay" });
    assert.deepEqual(app.state.activated, []);
    assert.deepEqual(await app.openTicketForAccount(OWNER, "project-15", "9621"), { id: TASK.id });
  } finally {
    app.restore();
  }
});

test("a forged account id cannot open a ticket that device sessions cannot see", async () => {
  const app = harness();
  try {
    app.state.sessions = [
      { user: { id: STRANGER, email: "stranger@example.com" }, session: { token: STRANGER_TOKEN } },
    ];
    const response = await app.route(request(ticketBody));
    assert.deepEqual(await response.json(), { action: "stay" });
    assert.deepEqual(app.state.activated, []);
    assert.equal(app.state.lookups.some((lookup) => lookup.userId === OWNER), false);
    assert.equal(await app.openTicketForAccount(STRANGER, "project-15", "9621"), null);
  } finally {
    app.restore();
  }
});

test("several accounts that can open the ticket show the switcher and name none of them", async () => {
  const app = harness();
  try {
    app.state.sessions = [
      { user: { id: OWNER, email: "owner@example.com" }, session: { token: OWNER_TOKEN } },
      { user: { id: MEMBER, email: "member@example.com" }, session: { token: MEMBER_TOKEN } },
    ];
    const response = await app.route(request(ticketBody));
    const body = await response.json();
    assert.deepEqual(body, { action: "choose" });
    assert.deepEqual(app.state.activated, []);
    assert.equal(JSON.stringify(body).includes(OWNER_TOKEN), false);
    assert.equal(JSON.stringify(body).includes(MEMBER_TOKEN), false);
    assert.equal(JSON.stringify(body).includes("owner@example.com"), false);
    assert.deepEqual(await app.openTicketForAccount(OWNER, "project-15", "9621"), { id: TASK.id });
    assert.deepEqual(await app.openTicketForAccount(MEMBER, "project-15", "9621"), { id: TASK.id });
  } finally {
    app.restore();
  }
});

test("the flag off leaves the block page without checking other accounts", async () => {
  const app = harness();
  try {
    app.state.enabled = false;
    app.state.sessions = [
      { user: { id: OWNER }, session: { token: OWNER_TOKEN } },
    ];
    const response = await app.route(request(ticketBody));
    assert.deepEqual(await response.json(), { action: "stay" });
    assert.equal(app.state.listed, 0);
    assert.equal(app.state.lookups.length, 0);
    assert.deepEqual(app.state.activated, []);
  } finally {
    app.restore();
  }
});

test("ticket links outside a numeric detail url do not ask who can open them", async () => {
  const { ticketDetailLocator, ticketDetailFields } = load("src/lib/auth/ticketDetailLocator.ts");
  assert.deepEqual(ticketDetailLocator("/detail/project-15/9621"), {
    projectSlug: "project-15",
    uniqueIndex: "9621",
  });
  assert.equal(ticketDetailLocator("/unauthorized"), null);
  assert.equal(ticketDetailLocator("/detail/project-15/HT-9621"), null);
  assert.equal(ticketDetailFields("project-15", "9621")?.uniqueIndex, "9621");
  assert.equal(ticketDetailFields("board-15", "9621"), null);
  assert.equal(ticketDetailFields("project-15", "HT-9621"), null);
});
