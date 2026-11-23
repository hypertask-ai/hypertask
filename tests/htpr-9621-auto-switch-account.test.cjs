const assert = require("node:assert/strict");
const fs = require("node:fs");
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

function userIdFromWhere(where) {
  const branches = where?.project?.OR ?? [];
  const owner = branches.find((branch) => typeof branch.ownerId === "number");
  return owner?.ownerId ?? branches.find((branch) => branch.members?.some)?.members.some.userId ?? null;
}

function opOf(model, op, select) {
  return `${model}.${op}:${select ? Object.keys(select).sort().join() : ""}`;
}

function harness() {
  const state = {
    enabled: true,
    prefixEnabled: true,
    userId: WRONG,
    sessions: [],
    sessionRows: [],
    activated: [],
    switchCookies: [],
    lookups: [],
    ops: [],
    listed: 0,
    alias: null,
    liveSlug: null,
    taskExists: true,
    flagChecks: [],
    rateLimitThrows: false,
    sessionLookupThrows: false,
    ticketLookupThrows: false,
    identifierLookups: [],
    taskWhere: null,
    projectContentAccessWhere: null,
  };
  const prisma = {
    task: {
      findFirst: async ({ where, select }) => {
        if (state.ticketLookupThrows) throw new Error("ticket db down");
        state.ops.push(opOf("task", "findFirst", select));
        state.lookups.push({ where, select, userId: userIdFromWhere(where) });
        const keys = select ? Object.keys(select).sort().join() : "";
        if (!where?.project) {
          if (state.liveSlug && where?.uniqueIndex === state.liveSlug.uniqueIndex && where?.projectId === state.liveSlug.projectId) {
            return { id: state.liveSlug.id };
          }
          if (state.taskExists && where?.uniqueIndex === TASK.uniqueIndex && where?.projectId === TASK.projectId && where?.status?.not === "Deleted") {
            return { id: TASK.id };
          }
          return null;
        }
        if (!state.taskExists) return null;
        if (where?.id === TASK.id && !where.uniqueIndex && keys === "id,projectId,uniqueIndex") {
          return ticketByProjectAccess(where.project, userIdFromWhere(where))
            ? { id: TASK.id, projectId: TASK.projectId, uniqueIndex: TASK.uniqueIndex }
            : null;
        }
        if (keys === "id" && select.id === true) {
          return matchesRealTaskWhere(where) ? { id: TASK.id } : null;
        }
        if (keys === "projectId,uniqueIndex" && select.projectId === true && select.uniqueIndex === true) {
          return matchesRealTaskWhere(where) ? { projectId: TASK.projectId, uniqueIndex: TASK.uniqueIndex } : null;
        }
        return null;
      },
    },
    taskNumberAlias: {
      findUnique: async () => {
        state.ops.push(opOf("taskNumberAlias", "findUnique"));
        return state.alias;
      },
    },
    betterAuthSession: {
      findFirst: async ({ where }) => {
        if (state.sessionLookupThrows) throw new Error("session db down");
        state.ops.push(opOf("betterAuthSession", "findFirst"));
        const cutoff = where?.expiresAt?.gt;
        const row = state.sessionRows.find((item) => item.token === where?.token && item.userId === where?.userId);
        if (!row || !(cutoff instanceof Date) || !(row.expiresAt > cutoff)) return null;
        return { userId: row.userId };
      },
    },
  };

  function ticketByProjectAccess(project, userId) {
    if (!state.projectContentAccessWhere || (userId !== OWNER && userId !== MEMBER)) return false;
    const expected = { status: { not: "Deleted" }, ...state.projectContentAccessWhere(userId) };
    return JSON.stringify(project) === JSON.stringify(expected);
  }

  function matchesRealTaskWhere(where) {
    const userId = userIdFromWhere(where);
    if (!state.taskWhere || (userId !== OWNER && userId !== MEMBER)) return false;
    if (where?.uniqueIndex !== TASK.uniqueIndex || where?.project?.id !== BOARD.id) return false;
    const expected = state.taskWhere({ projectId: BOARD.id, uniqueIndex: TASK.uniqueIndex }, userId);
    const expectedWhere = where?.id == null ? expected : { ...expected, id: where.id };
    return JSON.stringify(where) === JSON.stringify(expectedWhere);
  }
  function cookieFrom(headers) {
    if (!headers) return "";
    if (typeof headers.get === "function") return headers.get("cookie") ?? "";
    return headers.cookie ?? "";
  }
  const accountIdForToken = {
    [OWNER_TOKEN]: OWNER,
    [MEMBER_TOKEN]: MEMBER,
    [STRANGER_TOKEN]: STRANGER,
  };
  const auth = {
    api: {
      listDeviceSessions: async ({ headers } = {}) => {
        state.listed += 1;
        const cookie = cookieFrom(headers);
        if (!cookie.includes("better-auth.session_token=active")) return [];
        return state.sessions;
      },
      setActiveSession: async ({ body, headers }) => {
        state.activated.push(body.sessionToken);
        const cookie = cookieFrom(headers);
        state.switchCookies.push(cookie);
        const headerBag = new Headers();
        headerBag.append("set-cookie", `better-auth.session_token=${body.sessionToken}; Path=/`);
        if (cookie.includes("better-auth.session_token=active")) {
          const accountId = accountIdForToken[body.sessionToken];
          headerBag.append("set-cookie", `ht_session=bridge-${body.sessionToken}; Path=/; HttpOnly`);
          headerBag.append("set-cookie", `nookies_user=${encodeURIComponent(JSON.stringify({ id: accountId, displayName: "Ada Owner" }))}; Path=/`);
        }
        return new Response(null, { status: 200, headers: headerBag });
      },
    },
  };
  const rateLimit = load("src/lib/auth/ticketAccountSwitchRateLimit.ts", {
    "@/lib/redis": { getRedis: async () => { throw new Error("redis down"); } },
    "@/lib/auth/qaLoginRateLimit": { getQaLoginClientIp: () => "203.0.113.4" },
  });
  const mocks = {
    "next/server": {
      NextResponse: {
        json: (body, init) => Response.json(body, { headers: init?.headers }),
        redirect: (url, status = 307) => ({
          status,
          headers: new Headers({ location: String(url) }),
          text: async () => "",
        }),
      },
    },
    "@/lib/auth/serverUser": {
      getServerCookieUser: async () => (state.userId == null ? null : { id: state.userId }),
    },
    "@/lib/flags": {
      isFeatureEnabled: async (flag, userId) => {
        state.flagChecks.push([flag, userId]);
        if (flag === "htpr-6868-ticket-prefix") return state.prefixEnabled;
        if (flag === "htpr-9621-auto-switch-account") return state.enabled;
        return false;
      },
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
    "@vercel/functions": { waitUntil: () => {}, ipAddress: () => "203.0.113.4" },
    "@/lib/auth/ticketAccountSwitchRateLimit": {
      getTicketAccountSwitchClientIp: rateLimit.getTicketAccountSwitchClientIp,
      claimTicketAccountSwitchAttempt: async (userId, clientIp) => {
        if (state.rateLimitThrows) throw new Error("redis down");
        return rateLimit.claimTicketAccountSwitchAttempt(userId, clientIp);
      },
    },
    "@/lib/realtime/server": { broadcastTaskChange: async () => {} },
    "@/lib/mcp/tasks/resolveTask": {
      findTaskByIdentifier: async (user, options, _agentId, projectAccess) => {
        state.identifierLookups.push({
          userId: user?.id,
          ticket: options?.ticket_number,
          projectId: options?.project_id,
          projectAccess,
        });
        if (String(options?.ticket_number ?? "").toUpperCase() !== "HT-9621") return null;
        if (options?.project_id !== BOARD.id || !state.taskExists) return null;
        if (!ticketByProjectAccess(projectAccess, user?.id)) return null;
        return { id: TASK.id, projectId: BOARD.id };
      },
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
  const projects = load("src/utils/controllers/projects/getAllIncludes.ts", mocks);
  state.taskWhere = detail.taskWhere;
  state.projectContentAccessWhere = projects.projectContentAccessWhere;
  return {
    state,
    route: route.POST,
    openTicketForAccount: access.openTicketForAccount,
    taskWhere: detail.taskWhere,
    projectContentAccessWhere: projects.projectContentAccessWhere,
    parseDetailSlug: detail.parseDetailSlug,
    restore() {
      if (previous === undefined) delete process.env.BETTER_AUTH_ENABLED;
      else process.env.BETTER_AUTH_ENABLED = previous;
    },
  };
}

const SITE = "https://app.hypertask.ai";

function request(body, origin = SITE) {
  return new Request(`${SITE}/api/auth/ticket-account-switch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "better-auth.session_token=active",
      host: "app.hypertask.ai",
      "x-forwarded-proto": "https",
      ...(origin === null ? {} : { origin }),
    },
    body: JSON.stringify(body),
  });
}

function formRequest(fields, origin = SITE) {
  return new Request(`${SITE}/api/auth/ticket-account-switch`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: "better-auth.session_token=active",
      host: "app.hypertask.ai",
      "x-forwarded-proto": "https",
      ...(origin === null ? {} : { origin }),
    },
    body: new URLSearchParams(fields),
  });
}

function trust(app, sessions = app.state.sessions) {
  app.state.sessionRows = sessions.map((row) => ({
    token: row.session.token,
    userId: Number(row.user.id),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }));
}

function bridgeUser(response) {
  const listed = cookieHeader(response).split("\n");
  const raw = listed.find((cookie) => cookie.startsWith("nookies_user="));
  if (!raw) return null;
  return JSON.parse(decodeURIComponent(raw.slice("nookies_user=".length).split(";")[0]));
}

function locationPath(response) {
  return new URL(response.headers.get("location")).pathname;
}

function cookieHeader(response) {
  const listed = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  return listed.length ? listed.join("\n") : (response.headers.get("set-cookie") ?? "");
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
    trust(app);
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
    assert.deepEqual(wrongLookup.where.project, {
      id: slug.projectId,
      status: { not: "Deleted" },
      ...app.projectContentAccessWhere(WRONG),
    });
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
    trust(app);
    app.state.lookups.length = 0;
    const response = await app.route(request(ticketBody));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { action: "switch" });
    assert.deepEqual(app.state.activated, [OWNER_TOKEN]);
    assert.equal(response.headers.get("set-cookie")?.includes(OWNER_TOKEN), true);
    const switched = app.state.lookups.find((lookup) => lookup.userId === OWNER);
    assert.ok(switched);
    assert.deepEqual(switched.where, app.taskWhere(slug, OWNER));
    assert.deepEqual(switched.where.project, {
      id: slug.projectId,
      status: { not: "Deleted" },
      ...app.projectContentAccessWhere(OWNER),
    });
    const openedAs = bridgeUser(response);
    assert.equal(openedAs?.id, OWNER);
    assert.equal(cookieHeader(response).includes("ht_session=bridge-owner-session"), true);
    assert.equal(app.state.switchCookies[0]?.includes("better-auth.session_token=active"), true);
    assert.deepEqual(await app.openTicketForAccount(openedAs.id, "project-15", "9621"), { id: TASK.id });

    app.state.userId = OWNER;
    app.state.sessions = [
      { user: { id: STRANGER }, session: { token: STRANGER_TOKEN } },
    ];
    trust(app);
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
    trust(app);
    const response = await app.route(request(ticketBody));
    assert.deepEqual(await response.json(), { action: "stay" });
    assert.deepEqual(app.state.activated, []);
    assert.equal(app.state.lookups.some((lookup) => lookup.userId === OWNER), false);
    assert.equal(await app.openTicketForAccount(STRANGER, "project-15", "9621"), null);
  } finally {
    app.restore();
  }
});

test("an old ticket number still opens for the account that can see where it moved", async () => {
  const app = harness();
  try {
    const oldSlug = app.parseDetailSlug(["project-15", "1000"]);
    const currentSlug = app.parseDetailSlug(["project-15", "9621"]);
    app.state.alias = { task: { id: TASK.id, projectId: TASK.projectId, uniqueIndex: TASK.uniqueIndex } };
    assert.equal(await app.openTicketForAccount(WRONG, "project-15", "1000"), null);
    assert.deepEqual(await app.openTicketForAccount(OWNER, "project-15", "1000"), { id: TASK.id });
    const ownerLookup = app.state.lookups.find((lookup) => lookup.userId === OWNER && lookup.where?.uniqueIndex === TASK.uniqueIndex && lookup.select?.id === true);
    assert.deepEqual(ownerLookup.where, app.taskWhere(currentSlug, OWNER));

    app.state.sessions = [
      { user: { id: OWNER, email: "owner@example.com" }, session: { token: OWNER_TOKEN } },
    ];
    trust(app);
    const response = await app.route(request({ projectSlug: "project-15", uniqueIndex: "1000", title: TASK.title }));
    const body = await response.json();
    assert.deepEqual(body, { action: "switch" });
    assert.equal(JSON.stringify(body).includes("9621"), false);
    assert.equal(JSON.stringify(body).includes(TASK.title), false);
    assert.deepEqual(app.state.activated, [OWNER_TOKEN]);

    const form = await app.route(formRequest({ projectSlug: "project-15", uniqueIndex: "1000" }));
    assert.equal(locationPath(form), "/detail/project-15/1000");
    assert.equal(form.headers.get("location").includes("9621"), false);

    app.state.liveSlug = { id: 99, projectId: 15, uniqueIndex: 1000 };
    app.state.activated.length = 0;
    assert.equal(await app.openTicketForAccount(OWNER, "project-15", "1000"), null);
    const occupied = await app.route(request({ projectSlug: "project-15", uniqueIndex: "1000" }));
    assert.deepEqual(await occupied.json(), { action: "stay" });
    assert.deepEqual(app.state.activated, []);
    assert.deepEqual(oldSlug, { projectId: 15, uniqueIndex: 1000 });
  } finally {
    app.restore();
  }
});

test("a form post returns to that ticket and carries only the account that can open it", async () => {
  const app = harness();
  try {
    app.state.sessions = [
      { user: { id: STRANGER, email: "stranger@example.com" }, session: { token: STRANGER_TOKEN } },
      { user: { id: OWNER, email: "owner@example.com" }, session: { token: OWNER_TOKEN } },
    ];
    trust(app);
    const response = await app.route(formRequest({
      projectSlug: "project-15",
      uniqueIndex: "9621",
      userId: String(OWNER),
      sessionToken: FORGED_TOKEN,
      title: TASK.title,
    }));
    assert.equal(response.status, 303);
    assert.equal(locationPath(response), "/detail/project-15/9621");
    assert.equal(new URL(response.headers.get("location")).origin, "https://app.hypertask.ai");
    const cookies = cookieHeader(response);
    assert.equal(cookies.includes(OWNER_TOKEN), true);
    assert.equal(cookies.includes("ht_session=bridge-owner-session"), true);
    assert.equal(cookies.includes("nookies_user="), true);
    assert.equal(app.state.switchCookies[0]?.includes("better-auth.session_token=active"), true);
    const openedAs = bridgeUser(response);
    assert.equal(openedAs?.id, OWNER);
    assert.deepEqual(await app.openTicketForAccount(openedAs.id, "project-15", "9621"), { id: TASK.id });
    assert.equal(cookies.includes(TASK.title), false);
    assert.equal(cookies.includes("owner@example.com"), false);
    assert.deepEqual(app.state.activated, [OWNER_TOKEN]);
    assert.equal(await response.text(), "");

    const evil = await app.route(formRequest({ projectSlug: "https://evil.test", uniqueIndex: "9621" }));
    assert.equal(locationPath(evil), "/inbox");
    assert.equal(evil.headers.get("location").includes("evil"), false);
    const nested = await app.route(formRequest({ projectSlug: "project-15", uniqueIndex: "9621/../admin" }));
    assert.equal(locationPath(nested), "/inbox");
    assert.equal(nested.headers.get("location").includes("admin"), false);
  } finally {
    app.restore();
  }
});

test("several accounts send the browser back with a choose mark and name none of them", async () => {
  const app = harness();
  try {
    app.state.sessions = [
      { user: { id: OWNER, email: "owner@example.com" }, session: { token: OWNER_TOKEN } },
      { user: { id: MEMBER, email: "member@example.com" }, session: { token: MEMBER_TOKEN } },
    ];
    trust(app);
    const response = await app.route(formRequest({ projectSlug: "project-15", uniqueIndex: "9621" }));
    assert.equal(response.status, 303);
    assert.equal(locationPath(response), "/detail/project-15/9621");
    const cookies = cookieHeader(response);
    assert.equal(cookies.includes("ticket-account-switch=choose"), true);
    assert.equal(cookies.includes(OWNER_TOKEN), false);
    assert.equal(cookies.includes(MEMBER_TOKEN), false);
    assert.equal(cookies.includes("owner@example.com"), false);
    assert.deepEqual(app.state.activated, []);
    assert.deepEqual(await app.openTicketForAccount(OWNER, "project-15", "9621"), { id: TASK.id });
    assert.deepEqual(await app.openTicketForAccount(MEMBER, "project-15", "9621"), { id: TASK.id });
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
    trust(app);
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
    assert.deepEqual(app.state.flagChecks, [["htpr-9621-auto-switch-account", WRONG]]);
    assert.equal(app.state.listed, 0);
    assert.equal(app.state.lookups.length, 0);
    assert.deepEqual(app.state.activated, []);
  } finally {
    app.restore();
  }
});

test("the flag provider asks only while that flag is on", () => {
  const state = fs.readFileSync("src/lib/state.tsx", "utf8");
  const probe = fs.readFileSync("src/lib/auth/ticketAccountSwitchProbe.tsx", "utf8");
  assert.equal(state.includes('import("@/lib/auth/ticketAccountSwitchProbe")'), true);
  assert.equal(state.includes("ticketAccountSwitchFlagOn"), true);
  assert.equal(state.includes("if (!enabled) return;"), true);
  assert.equal(state.includes("return enabled && Probe ? <Probe /> : null;"), true);
  assert.equal(probe.includes("if (!ticketAccountSwitchFlagOn(flags))"), true);
  assert.equal(probe.includes("ticketAccountSwitchFlagOn"), true);
  assert.equal(
    probe.indexOf("syncSwitchedAccountTabs(") > probe.indexOf("if (!ticketAccountSwitchFlagOn(flags))"),
    true,
  );
});

test("with the flag off neither the slot nor the tab sync runs", () => {
  const key = load("src/lib/flags/definitions/htpr-9621-auto-switch-account.ts").HTPR_9621_AUTO_SWITCH_ACCOUNT_FLAG;
  const { ticketAccountSwitchFlagOn } = load("src/lib/auth/ticketDetailLocator.ts");
  const state = fs.readFileSync("src/lib/state.tsx", "utf8");
  const probe = fs.readFileSync("src/lib/auth/ticketAccountSwitchProbe.tsx", "utf8");
  assert.equal(ticketAccountSwitchFlagOn(undefined), false);
  assert.equal(ticketAccountSwitchFlagOn({}), false);
  assert.equal(ticketAccountSwitchFlagOn({ [key]: false }), false);
  assert.equal(ticketAccountSwitchFlagOn({ "htpr-another-flag": true }), false);
  assert.equal(ticketAccountSwitchFlagOn({ [key]: true }), true);
  assert.equal(state.includes("return enabled && Probe ? <Probe /> : null;"), true);
  assert.equal(state.includes("if (!enabled) return;"), true);
  assert.equal(
    probe.indexOf("syncSwitchedAccountTabs(") > probe.indexOf("if (!ticketAccountSwitchFlagOn(flags))"),
    true,
  );
});

test("a cross-origin post returns to the ticket without switching", async () => {
  const app = harness();
  try {
    app.state.sessions = [
      { user: { id: OWNER, email: "owner@example.com" }, session: { token: OWNER_TOKEN } },
    ];
    trust(app);
    const json = await app.route(request(ticketBody, "https://evil.test"));
    assert.deepEqual(await json.json(), { action: "stay" });
    const missing = await app.route(request(ticketBody, null));
    assert.deepEqual(await missing.json(), { action: "stay" });
    const page = await app.route(formRequest({ projectSlug: "project-15", uniqueIndex: "9621" }, "https://evil.test"));
    assert.equal(page.status, 303);
    assert.equal(locationPath(page), "/detail/project-15/9621");
    assert.equal(cookieHeader(page).includes("ticket-account-switched=1"), false);
    assert.deepEqual(app.state.flagChecks, []);
    assert.equal(app.state.listed, 0);
    assert.deepEqual(app.state.lookups, []);
    assert.deepEqual(app.state.activated, []);
  } finally {
    app.restore();
  }
});

test("a same-origin post still switches", async () => {
  const app = harness();
  try {
    app.state.sessions = [
      { user: { id: OWNER, email: "owner@example.com" }, session: { token: OWNER_TOKEN } },
    ];
    trust(app);
    const response = await app.route(request(ticketBody));
    assert.deepEqual(await response.json(), { action: "switch" });
    assert.deepEqual(app.state.activated, [OWNER_TOKEN]);
  } finally {
    app.restore();
  }
});

test("ticket links outside a numeric detail url do not ask who can open them", async () => {
  const { ticketDetailLocator, ticketDetailFields, ticketAccountSwitchPath } = load("src/lib/auth/ticketDetailLocator.ts");
  assert.deepEqual(ticketDetailLocator("/detail/project-15/9621"), {
    projectSlug: "project-15",
    uniqueIndex: "9621",
  });
  assert.equal(ticketDetailLocator("/unauthorized"), null);
  assert.deepEqual(ticketDetailLocator("/detail/project-15/HT-9621"), {
    projectSlug: "project-15",
    uniqueIndex: "HT-9621",
  });
  assert.equal(ticketDetailFields("project-15", "9621")?.uniqueIndex, "9621");
  assert.equal(ticketDetailFields("board-15", "9621"), null);
  assert.deepEqual(ticketDetailFields("project-15", "HT-9621"), {
    projectSlug: "project-15",
    uniqueIndex: "HT-9621",
  });
  assert.equal(ticketAccountSwitchPath("/detail/project-15/HT-9621"), "/detail/project-15/HT-9621");
  assert.equal(ticketAccountSwitchPath("/detail/project-15/9621/"), "/detail/project-15/9621");
  assert.equal(ticketAccountSwitchPath("/detail/project-15/9621?next=https://evil.test"), "/detail/project-15/9621");
  assert.equal(ticketAccountSwitchPath("//evil.test/detail/project-15/9621"), null);
  assert.equal(ticketAccountSwitchPath("https://evil.test/detail/project-15/9621"), null);
  assert.equal(ticketAccountSwitchPath("/inbox"), null);
});

test("choosing an account reloads that ticket, and any other return path still opens the inbox", () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const events = [];
  const forms = [];
  const opened = [];
  const storage = new Map();
  let cookie = "";
  const inputs = [];
  global.window = {
    location: {
      pathname: "/detail/project-15/9621/",
      assign: (url) => events.push(["assign", url]),
      reload: () => events.push(["reload"]),
    },
    sessionStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
  };
  global.document = {
    get cookie() { return cookie; },
    set cookie(value) { cookie = value; },
    getElementById: (id) => (id === "unauthorized-title" ? { id } : null),
    createElement: (tag) => {
      const element = {
        tag,
        type: "",
        name: "",
        value: "",
        method: "",
        action: "",
        children: [],
        append(child) { this.children.push(child); },
        submit() { forms.push(this); },
      };
      if (tag === "input") inputs.push(element);
      return element;
    },
    body: { append() {} },
  };
  try {
    const locator = load("src/lib/auth/ticketDetailLocator.ts");
    assert.equal(locator.ticketAccountSwitchStays(), true);
    locator.openSwitchedTicketAccount();
    assert.deepEqual(events, [["reload"]]);
    assert.equal(storage.size, 0);

    events.length = 0;
    locator.rememberTicketAccountSwitch("https://evil.test/detail/project-15/9621");
    locator.openSwitchedTicketAccount();
    assert.deepEqual(events, [["assign", "/inbox"]]);

    events.length = 0;
    assert.equal(locator.ticketAccountSwitchStays(), true);
    locator.forgetTicketAccountSwitch();
    locator.openSwitchedTicketAccount();
    assert.deepEqual(events, [["assign", "/inbox"]]);

    events.length = 0;
    global.window.location.pathname = "/inbox";
    assert.equal(locator.ticketAccountSwitchStays(), false);
    locator.openSwitchedTicketAccount();
    assert.deepEqual(events, [["assign", "/inbox"]]);
    assert.equal(storage.size, 0);

    forms.length = 0;
    global.window.location.pathname = "/detail/project-15/9621";
    global.document.getElementById = () => null;
    assert.equal(locator.ticketAccountSwitchStays(), false);
    locator.submitTicketAccountSwitch("/detail/project-15/9621", () => opened.push("switcher"));
    assert.equal(forms.length, 0);

    global.document.getElementById = (id) => (id === "unauthorized-title" ? { id } : null);
    global.window.location.pathname = "/detail/project-15/9621";
    locator.submitTicketAccountSwitch("/detail/project-15/9621", () => opened.push("switcher"));
    assert.equal(forms.length, 1);
    assert.equal(forms[0].method, "POST");
    assert.equal(forms[0].action, "/api/auth/ticket-account-switch");
    assert.deepEqual(inputs.map((input) => [input.name, input.value]), [
      ["projectSlug", "project-15"],
      ["uniqueIndex", "9621"],
    ]);
    locator.submitTicketAccountSwitch("/detail/project-15/9621", () => opened.push("switcher"));
    assert.equal(forms.length, 1);
    assert.deepEqual(opened, []);

    cookie = "ticket-account-switch=choose";
    global.window.location.pathname = "/detail/project-15/1000";
    locator.submitTicketAccountSwitch("/detail/project-15/1000", () => opened.push("switcher"));
    assert.equal(forms.length, 1);
    assert.deepEqual(opened, ["switcher"]);
    assert.equal(cookie.includes("Max-Age=0"), true);
    assert.equal(storage.get("ticket-account-switch-return"), "/detail/project-15/1000");
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test("a missing ticket and a ticket no verified sibling can open answer the same way", async () => {
  const app = harness();
  try {
    app.state.sessions = [
      { user: { id: STRANGER, email: "stranger@example.com" }, session: { token: STRANGER_TOKEN } },
    ];
    trust(app);
    app.state.taskExists = false;
    const missing = await app.route(request({ projectSlug: "project-15", uniqueIndex: "9621" }));
    const missingBody = await missing.json();
    const missingOps = app.state.ops.slice();

    app.state.taskExists = true;
    app.state.ops = [];
    const hidden = await app.route(request({ projectSlug: "project-15", uniqueIndex: "9621" }));
    const hiddenBody = await hidden.json();

    assert.deepEqual(missingBody, { action: "stay" });
    assert.deepEqual(hiddenBody, missingBody);
    assert.equal(missing.status, hidden.status);
    assert.deepEqual(hiddenBody, { action: "stay" });
    assert.deepEqual(app.state.ops, missingOps);
    assert.equal(missingOps.some((op) => op.startsWith("task.findFirst")), true);
    assert.equal(JSON.stringify(missingBody).includes(String(TASK.id)), false);
    assert.equal(JSON.stringify(hiddenBody).includes(TASK.title), false);
    assert.deepEqual(app.state.activated, []);
  } finally {
    app.restore();
  }
});

test("an unverified sibling session does not reveal whether the ticket exists", async () => {
  const app = harness();
  try {
    app.state.sessions = [
      { user: { id: OWNER, email: "owner@example.com" }, session: { token: OWNER_TOKEN } },
    ];
    const hidden = await app.route(request(ticketBody));
    const hiddenOps = app.state.ops.slice();
    app.state.taskExists = false;
    app.state.ops = [];
    const missing = await app.route(request(ticketBody));
    assert.deepEqual(await hidden.json(), { action: "stay" });
    assert.deepEqual(await missing.json(), { action: "stay" });
    assert.deepEqual(app.state.ops, hiddenOps);
    assert.equal(hiddenOps.some((op) => op.startsWith("task.")), false);
    assert.deepEqual(app.state.activated, []);
    assert.equal(app.state.sessionRows.length, 0);
  } finally {
    app.restore();
  }
});

test("a prefixed ticket key opens for the account the detail page would allow", async () => {
  const app = harness();
  try {
    app.state.sessions = [
      { user: { id: OWNER, email: "owner@example.com" }, session: { token: OWNER_TOKEN } },
    ];
    trust(app);
    const response = await app.route(request({ projectSlug: "project-15", uniqueIndex: "HT-9621", sessionToken: FORGED_TOKEN }));
    assert.deepEqual(await response.json(), { action: "switch" });
    const lookup = app.state.identifierLookups.find((item) => item.userId === OWNER);
    assert.ok(lookup);
    assert.deepEqual(lookup.projectAccess, {
      status: { not: "Deleted" },
      ...app.projectContentAccessWhere(OWNER),
    });
    assert.deepEqual(await app.openTicketForAccount(OWNER, "project-15", "HT-9621"), { id: TASK.id });
    assert.equal(await app.openTicketForAccount(STRANGER, "project-15", "HT-9621"), null);

    const form = await app.route(formRequest({ projectSlug: "project-15", uniqueIndex: "HT-9621" }));
    assert.equal(form.status, 303);
    assert.equal(locationPath(form), "/detail/project-15/HT-9621");
    assert.equal(bridgeUser(form)?.id, OWNER);
    assert.equal(cookieHeader(form).includes("ht_session="), true);

    const lookedUp = app.state.identifierLookups.length;
    app.state.prefixEnabled = false;
    app.state.activated = [];
    const disabled = await app.route(request({ projectSlug: "project-15", uniqueIndex: "HT-9621" }));
    assert.deepEqual(await disabled.json(), { action: "stay" });
    assert.deepEqual(app.state.activated, []);
    assert.equal(app.state.identifierLookups.length, lookedUp);
  } finally {
    app.restore();
  }
});

test("repeated probes stop before another ticket lookup", async () => {
  const app = harness();
  try {
    const limit = load("src/lib/auth/ticketAccountSwitchRateLimit.ts", {
      "@/lib/redis": { getRedis: async () => { throw new Error("redis down"); } },
      "@/lib/auth/qaLoginRateLimit": { getQaLoginClientIp: () => "203.0.113.4" },
    }).TICKET_ACCOUNT_SWITCH_USER_LIMIT;
    app.state.sessions = [
      { user: { id: OWNER }, session: { token: OWNER_TOKEN } },
    ];
    trust(app);
    for (let attempt = 0; attempt < limit; attempt += 1) {
      const response = await app.route(request(ticketBody));
      assert.equal((await response.json()).action, "switch");
    }
    const lookups = app.state.lookups.length;
    const listed = app.state.listed;
    const blocked = await app.route(request(ticketBody));
    assert.deepEqual(await blocked.json(), { action: "stay" });
    assert.equal(blocked.status, 200);
    assert.equal(app.state.lookups.length, lookups);
    assert.equal(app.state.listed, listed);
    assert.equal(app.state.activated.length, limit);
  } finally {
    app.restore();
  }
});

test("a rate limit outage returns the browser to the ticket", async () => {
  const app = harness();
  try {
    app.state.rateLimitThrows = true;
    app.state.sessions = [
      { user: { id: OWNER }, session: { token: OWNER_TOKEN } },
    ];
    trust(app);
    const page = await app.route(formRequest({ projectSlug: "project-15", uniqueIndex: "9621" }));
    assert.equal(page.status, 303);
    assert.equal(locationPath(page), "/detail/project-15/9621");
    const body = await app.route(request(ticketBody));
    assert.equal(body.status, 200);
    assert.deepEqual(await body.json(), { action: "stay" });
    assert.equal(app.state.lookups.length, 0);
    assert.equal(app.state.listed, 0);
    assert.deepEqual(app.state.activated, []);
  } finally {
    app.restore();
  }
});

test("a session or ticket lookup outage returns the browser to the ticket", async () => {
  const app = harness();
  try {
    app.state.sessions = [
      { user: { id: OWNER }, session: { token: OWNER_TOKEN } },
    ];
    trust(app);
    app.state.sessionLookupThrows = true;
    const sessionPage = await app.route(formRequest({ projectSlug: "project-15", uniqueIndex: "9621" }));
    assert.equal(sessionPage.status, 303);
    assert.equal(locationPath(sessionPage), "/detail/project-15/9621");
    const sessionBody = await app.route(request(ticketBody));
    assert.deepEqual(await sessionBody.json(), { action: "stay" });

    app.state.sessionLookupThrows = false;
    app.state.ticketLookupThrows = true;
    const ticketPage = await app.route(formRequest({ projectSlug: "project-15", uniqueIndex: "9621" }));
    assert.equal(ticketPage.status, 303);
    assert.equal(locationPath(ticketPage), "/detail/project-15/9621");
    const ticketBodyResponse = await app.route(request(ticketBody));
    assert.equal(ticketBodyResponse.status, 200);
    assert.deepEqual(await ticketBodyResponse.json(), { action: "stay" });
    assert.deepEqual(app.state.activated, []);
  } finally {
    app.restore();
  }
});

test("the toast names the account that was switched to and other tabs reload", () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const events = [];
  const notices = [];
  const storage = new Map();
  const local = new Map();
  const listeners = [];
  let cookie = `nookies_user=${encodeURIComponent(JSON.stringify({ id: OWNER, displayName: "Ada Owner" }))}`;
  global.window = {
    location: {
      pathname: "/detail/project-15/9621",
      reload: () => events.push("reload"),
      assign: (url) => events.push(["assign", url]),
    },
    sessionStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    localStorage: {
      getItem: (key) => (local.has(key) ? local.get(key) : null),
      setItem: (key, value) => local.set(key, value),
      removeItem: (key) => local.delete(key),
    },
    addEventListener: (type, listener) => listeners.push([type, listener]),
    removeEventListener: () => {},
  };
  global.document = {
    get cookie() { return cookie; },
    set cookie(value) {
      const pair = value.split(";")[0];
      const name = pair.slice(0, pair.indexOf("="));
      const parts = cookie.split("; ").filter((part) => part && !part.startsWith(`${name}=`));
      if (!value.includes("Max-Age=0") && pair.slice(name.length + 1)) parts.push(pair);
      cookie = parts.join("; ");
    },
  };
  try {
    const locator = load("src/lib/auth/ticketDetailLocator.ts");
    assert.equal(locator.consumeAccountSwitchNotice(), null);
    const stopOldTab = locator.syncSwitchedAccountTabs(WRONG, (message) => notices.push(message));
    assert.deepEqual(notices, []);
    locator.rememberSwitchedAccount("Ada Owner", OWNER);
    const stopNewTab = locator.syncSwitchedAccountTabs(OWNER, (message) => notices.push(message));
    assert.deepEqual(notices, ["Switched to Ada Owner"]);
    assert.equal(local.get("ht-active-account"), String(OWNER));
    const oldTab = listeners[0][1];
    oldTab({ key: "ht-active-account", newValue: String(OWNER) });
    assert.deepEqual(events, ["reload"]);
    oldTab({ key: "ht-active-account", newValue: String(WRONG) });
    assert.deepEqual(events, ["reload"]);
    oldTab({ key: "other", newValue: "9" });
    assert.deepEqual(events, ["reload"]);
    stopOldTab();
    stopNewTab();

    notices.length = 0;
    cookie = [
      "ticket-account-switched=1",
      `nookies_user=${encodeURIComponent(JSON.stringify({ id: MEMBER, email: "member@example.com" }))}`,
    ].join("; ");
    locator.syncSwitchedAccountTabs(MEMBER, (message) => notices.push(message));
    assert.deepEqual(notices, ["Switched to member@example.com"]);
    listeners.at(-1)[1]({ key: "ht-active-account", newValue: String(MEMBER) });
    assert.deepEqual(events, ["reload"]);
    assert.equal(cookie.includes("ticket-account-switched=1"), false);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});
