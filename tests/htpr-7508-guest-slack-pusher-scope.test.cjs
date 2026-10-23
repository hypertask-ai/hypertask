const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { fixture, matches, hydrate } = require("./helpers/agent-board-scope.cjs");

function matchesProject(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return (Array.isArray(value) ? value : [value]).every(branch => matchesProject(row, branch));
    if (key === "googleAccount" && value.isNot === null) return row.googleAccount != null;
    return matches(row, { [key]: value });
  });
}

function harness({ area, actor = "agent", enforce = true, grant = "none", teamless = false, guest = true, emailMismatch = false, tutorialEnabled = true, teamAccess = true, authenticated = true, bypassBoardGate = false } = {}) {
  const f = fixture();
  f.state.enforce = enforce;
  if (actor !== "agent") f.state.ctx.agentId = null;
  f.user.uid = guest ? "guest_scope" : "human_scope";
  f.user.accountId = "account";
  const project = f.projects[2];
  if (area === "demo") {
    for (const other of f.projects.slice(0, 2)) {
      other.ownerId = 99;
      other.owner = { id: 99, agents: [] };
    }
  }
  Object.assign(project, { googleAccountId: "account", googleAccount: { id: "account" }, uniqueIdentifier: "SCOPE", title: area === "learn" ? "Learn Hypertask" : "Scope board" });
  if (teamless) project.teamId = null;
  if (actor === "member" || actor === "guest" || actor === "outsider") {
    project.ownerId = 99;
    project.owner = { id: 99, agents: [] };
    if (actor !== "outsider") project.members.push({ userId: f.user.id, agentId: null, status: "Accepted", role: actor === "guest" ? "Guest" : "Member", user: f.user });
  }
  if (grant !== "none") {
    const board = grant === "wrong-board" ? f.projects[0] : project;
    board.members.push({ agentId: f.agent.id, status: grant === "invited" ? "Invited" : "Accepted", agent: f.agent });
    if (grant === "revoked") f.agent.revokedAt = new Date();
    if (grant === "wrong-owner") f.agent.userId = 99;
  }
  const task = f.tasks[2];
  const queries = [];
  const writes = [];
  const subscriptions = [];
  f.prisma.project.findFirst = async args => {
    queries.push({ model: "project", ...args });
    return hydrate(f.projects.find(row => matchesProject(row, args.where)), args);
  };
  f.prisma.task.findUnique = async args => {
    queries.push({ model: "task", ...args });
    return hydrate(f.tasks.find(row => matches(row, args.where)), args);
  };
  f.prisma.member_Team = { findFirst: async () => null };
  f.prisma.slackInstall = {
    update: async args => { writes.push(args); return { defaultProjectId: args.data.defaultProjectId, slackTeamId: "slack-team", slackTeamName: "Workspace" }; },
    findUnique: async () => ({ defaultProjectId: project.id, slackTeamId: "slack-team", slackTeamName: "Workspace" }),
    deleteMany: async args => { writes.push(args); return { count: 1 }; },
  };
  const session = () => authenticated ? { id: f.user.id, email: emailMismatch ? "other@example.invalid" : f.user.email, agentId: f.state.ctx.agentId } : null;
  const sessionUser = async () => {
    if (!authenticated) return null;
    await f.scope.prepareAgentScope(f.user.id, f.state.ctx.agentId);
    return { userId: f.user.id, agentId: f.state.ctx.agentId };
  };
  const provision = async purpose => {
    writes.push({ provision: purpose });
    return { projectId: 901, boardUrl: "/project?id=901", uniqueIdentifier: "NEW", userRecord: { id: 900, uid: "guest_new", email: "guest-new@example.invalid" } };
  };
  const minimal = f.load("src/utils/controllers/projects/getAllMinimal.ts", {
    "@/lib/ai/teamBillingSnapshotSelect": {},
    "@/utils/helperFunctions/Views/BoardFilterSanitizer": {},
  });
  const services = f.load("src/lib/mcp/tasks/services.ts", {
    "@/lib/telemetry/savedWork": {},
    "./mappers": {},
    "@/lib/constants/constants": {},
    "@/utils/controllers/activities/createLabelActivity": {},
    "@/utils/controllers/urls/extractUrlsFromContent": {},
    "@/lib/auth/session": {},
    "@/lib/auth/slimUserCookie": {},
    "@/lib/agentWebhooks/outbox": {},
  });
  const mocks = {
    "@/lib/auth/getSessionUser": { getSessionUser: sessionUser },
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: session, signSession: () => "new-guest-token", sessionCookieOptions: () => ({}) },
    "@/lib/auth/slimUserCookie": { slimUserForCookie: user => ({ id: user.id }) },
    "@/lib/auth/betterAuth": { auth: { handler: async () => new Response(null, { status: 204 }) } },
    "@/lib/demo/provisionGuest": { provisionGuest: provision, provisionGuestBoard: async (...args) => { writes.push({ regenerate: args }); return { projectId: 902, boardUrl: "/project?id=902", uniqueIdentifier: "REGEN" }; }, provisionLearnBoard: async () => { throw new Error("Unexpected tutorial provisioning"); } },
    "@/lib/demo/generateDemoBoard": { DemoBoardGenerationUnavailableError: class extends Error {} },
    "@/lib/tutorial/keyboardShortcutTutorial": { KEYBOARD_SHORTCUT_TUTORIAL_ENABLED: tutorialEnabled },
    "@/utils/controllers/tutorial/ensureLearnTutorialInbox": { ensureLearnTutorialInbox: async () => [], validateLearnTutorialInboxTargets: async ({ targets }) => targets },
    "@/lib/auth/serverUser": { getServerCookieUser: async () => authenticated ? f.user : null },
    "@/utils/controllers/teams/hasTeamMembershipAccess": { hasTeamMembershipAccess: async (userId, teamId) => { assert.equal(userId, f.user.id); return teamAccess && teamId === "team"; } },
    "@/utils/controllers/projects/getAllMinimal": minimal,
    "@/lib/mcp/tasks/services": { validateProjectAccess: bypassBoardGate ? async () => ({ error: null }) : services.validateProjectAccess },
    "@/lib/realtime/server": { getRealtimeServer: () => ({ authorizeChannel: (socket, channel) => { subscriptions.push([socket, channel]); return { auth: `signed:${channel}` }; } }) },
  };
  const paths = { demo: "demo/guest", learn: "learn/board", slack: "slack/installation" };
  const route = f.load(area === "pusher" ? "src/pages/api/pusher/auth.ts" : `src/app/api/${paths[area]}/route.ts`, mocks);
  async function request(overrides = {}, method = area === "slack" ? "PATCH" : "POST") {
    const injected = { userId: 999, agentId: "forged-body-agent", actingAgentId: "forged-body-agent" };
    if (area === "pusher") {
      const result = {};
      const res = { status: code => { result.status = code; return res; }, json: body => { result.body = body; return res; } };
      await route.default({ url: "/api/pusher/auth?agentId=forged-query-agent", method, headers: { cookie: "ht_session=fixture" }, body: { ...injected, socket_id: "123.456", channel_name: `private-task-${task.id}`, ...overrides } }, res);
      return result;
    }
    const body = { demo: {}, learn: {}, slack: { defaultProjectId: project.id, teamId: "team" } }[area];
    const req = new NextRequest(`https://app.hypertask.ai/api/${paths[area]}?userId=999&agentId=forged-query-agent&teamId=team`, {
      method, headers: { "Content-Type": "application/json", cookie: "ht_session=fixture" },
      ...(method === "GET" ? {} : { body: JSON.stringify({ ...body, ...injected, ...overrides }) }),
    });
    const response = await route[method](req);
    return { status: response.status, body: await response.json() };
  }
  return { ...f, project, task, queries, writes, subscriptions, request };
}

async function allowed(h, area) {
  const result = await h.request();
  assert.equal(result.status, 200);
  if (area === "demo" || area === "learn") assert.equal(result.body.projectId, h.project.id);
  else if (area === "slack") assert.equal(result.body.install.defaultProjectId, h.project.id);
  else assert.deepEqual(h.subscriptions, [["123.456", `private-task-${h.task.id}`]]);
}

for (const area of ["demo", "learn", "slack", "pusher"]) {
  // These are direct internal calls, not externally reachable agent-cookie HTTP paths.
  test(`${area}: ungranted internal agent cannot reuse/read the existing board in ENFORCE`, async () => {
    const h = harness({ area });
    const result = await h.request();
    if (area === "demo") {
      assert.equal(result.status, 200);
      assert.equal(result.body.projectId, 901);
      assert.deepEqual(h.writes, [{ provision: "" }]);
    } else assert.equal(result.status, area === "learn" ? 422 : 403);
    assert.equal(h.subscriptions.length, 0);
    if (area !== "demo") assert.equal(h.writes.length, 0);
    assert.equal(h.state.flagReads, 1);
  });

  test(`${area}: same ungranted internal agent retains legacy access in WATCH`, async () => {
    const h = harness({ area, enforce: false });
    await allowed(h, area);
    assert.equal(h.state.flagReads, 1);
  });

  test(`${area}: active same-owner Accepted grant retains internal access`, async () => {
    const h = harness({ area, grant: "accepted" });
    await allowed(h, area);
    assert.equal(h.state.flagReads, 1);
  });

  for (const grant of ["wrong-board", "wrong-owner", "revoked", "invited"]) {
    test(`${area}: ${grant} grant does not authorize the recorded query`, async () => {
      const h = harness({ area, grant });
      const result = await h.request();
      if (area === "demo") assert.equal(result.body.projectId, 901);
      else assert.equal(result.status, area === "learn" ? 422 : 403);
      assert.equal(h.subscriptions.length, 0);
    });
  }
}

for (const area of ["demo", "learn", "slack", "pusher"]) {
  test(`${area}: human owner still allowed without reading the agent flag`, async () => {
    const h = harness({ area, actor: "owner" });
    await allowed(h, area);
    assert.equal(h.state.flagReads, 0);
  });
}

for (const area of ["slack", "pusher"]) {
  for (const actor of ["member", "guest"]) {
    test(`${area}: eligible human ${actor} retains board access`, async () => {
      const h = harness({ area, actor });
      await allowed(h, area);
      assert.equal(h.state.flagReads, 0);
    });
  }
}

for (const area of ["demo", "learn"]) {
  for (const actor of ["member", "guest"]) {
    test(`${area}: human ${actor} cannot reuse somebody else's owner-only board`, async () => {
      const h = harness({ area, actor });
      const result = await h.request();
      if (area === "demo") assert.equal(result.body.projectId, 901);
      else assert.equal(result.status, 422);
    });
  }
  test(`${area}: even an Accepted agent cannot bypass the owner-only predicate`, async () => {
    const h = harness({ area, grant: "accepted" });
    h.project.ownerId = 99;
    const result = await h.request();
    if (area === "demo") assert.equal(result.body.projectId, 901);
    else assert.equal(result.status, 422);
  });
}

for (const options of [{ guest: false }, { emailMismatch: true }, { authenticated: false }]) {
  test(`demo: existing guest reuse still requires the same valid guest ${JSON.stringify(options)}`, async () => {
    const h = harness({ area: "demo", actor: "owner", ...options });
    const result = await h.request();
    assert.equal(result.status, 200);
    assert.equal(result.body.projectId, options.guest === false ? null : 901);
    assert.equal(h.queries.length, 0);
  });
}

for (const mutation of [{ status: "Archive" }, { teamId: null }, { uniqueIdentifier: null }]) {
  test(`demo: existing board restriction ${JSON.stringify(mutation)} retained`, async () => {
    const h = harness({ area: "demo", actor: "owner" });
    Object.assign(h.project, mutation);
    assert.equal((await h.request()).body.projectId, 901);
  });
}

test("demo: guest regeneration retains the verified guest's account and team", async t => {
  const previous = process.env.DEMO_AI_GATEWAY_API_KEY;
  process.env.DEMO_AI_GATEWAY_API_KEY = "fixture-key";
  t.after(() => { if (previous === undefined) delete process.env.DEMO_AI_GATEWAY_API_KEY; else process.env.DEMO_AI_GATEWAY_API_KEY = previous; });
  const h = harness({ area: "demo", actor: "owner" });
  const result = await h.request({ purpose: "Build a board" });
  assert.equal(result.body.projectId, 902);
  assert.deepEqual(h.writes, [{ regenerate: ["Build a board", { userId: h.user.id, googleAccountId: "account", teamId: "team" }] }]);
});

test("learn: teamless tutorial owner keeps the content-helper path", async () => {
  await allowed(harness({ area: "learn", actor: "owner", teamless: true }), "learn");
});

for (const mutation of [{ status: "Archive" }, { title: "Other board" }]) {
  test(`learn: original tutorial restriction ${JSON.stringify(mutation)} retained`, async () => {
    const h = harness({ area: "learn", actor: "owner" });
    Object.assign(h.project, mutation);
    assert.equal((await h.request()).status, 422);
  });
}

test("learn: disabled tutorial still returns the unchanged 410 response", async () => {
  const h = harness({ area: "learn", actor: "owner", tutorialEnabled: false });
  assert.deepEqual(await h.request(), { status: 410, body: { error: "The keyboard shortcuts tutorial is temporarily unavailable" } });
  assert.equal(h.queries.length, 0);
});

test("learn: human return board keeps its team, membership and Normal requirements", async () => {
  for (const mutation of [{}, { ownerId: 99, members: [] }, { teamId: null }, { status: "Archive" }]) {
    const h = harness({ area: "learn", actor: "owner" });
    const board = h.projects[0];
    Object.assign(board, mutation);
    const result = await h.request({ returnBoardId: board.id });
    assert.equal(result.status, 200);
    assert.equal(result.body.returnBoardId, Object.keys(mutation).length ? null : board.id);
  }
});

for (const mutation of [{ status: "Archive" }, { teamId: "another-team" }, { teamId: null }, { googleAccount: null }]) {
  test(`slack: original status, account and exact team predicate retained ${JSON.stringify(mutation)}`, async () => {
    const h = harness({ area: "slack", actor: "owner" });
    Object.assign(h.project, mutation);
    const result = await h.request();
    assert.deepEqual(result, { status: 403, body: { error: "Project is not available to this team" } });
    assert.deepEqual(h.writes, []);
  });
}

test("slack: workspace membership and board access are independently required", async () => {
  const deniedTeam = harness({ area: "slack", actor: "owner", teamAccess: false });
  assert.deepEqual(await deniedTeam.request(), { status: 403, body: { error: "Team access denied" } });
  assert.deepEqual(deniedTeam.queries, []);
  const deniedBoard = harness({ area: "slack", actor: "outsider" });
  assert.equal((await deniedBoard.request()).status, 403);
  assert.deepEqual(deniedBoard.writes, []);
});

test("slack: Accepted agent grant cannot widen the original human board predicate", async () => {
  const h = harness({ area: "slack", grant: "accepted" });
  h.project.ownerId = 99;
  h.project.owner = { id: 99, agents: [] };
  assert.equal((await h.request()).status, 403);
  assert.deepEqual(h.writes, []);
});

test("slack: clearing the default, reading and disconnecting keep their human contract", async () => {
  const h = harness({ area: "slack", actor: "member" });
  assert.equal((await h.request({ defaultProjectId: null })).body.install.defaultProjectId, null);
  assert.equal(h.queries.length, 0);
  assert.equal((await h.request({}, "GET")).body.install.defaultProjectId, h.project.id);
  assert.deepEqual(await h.request({}, "DELETE"), { status: 200, body: { success: true } });
});

for (const actor of ["owner", "member", "guest"]) {
  for (const kind of ["private-project", "private-time-project", "private-task", "private-time-task"]) {
    test(`pusher: human ${actor} retains ${kind} subscriptions`, async () => {
      const h = harness({ area: "pusher", actor });
      const channel = `${kind}-${kind.endsWith("task") ? h.task.id : h.project.id}`;
      assert.deepEqual(await h.request({ channel_name: channel }), { status: 200, body: { auth: `signed:${channel}` } });
      assert.deepEqual(h.subscriptions, [["123.456", channel]]);
    });
  }
  test(`pusher: human ${actor} retains only their own private-user and the feature-flag channel`, async () => {
    const h = harness({ area: "pusher", actor });
    for (const channel of [`private-user-${h.user.id}`, "private-feature-flags"]) assert.equal((await h.request({ channel_name: channel })).status, 200);
    for (const channel of ["private-user-999", "presence-project-2128", "presence-task-21280", "public-user-6", "unknown"]) assert.equal((await h.request({ channel_name: channel })).status, 403);
    assert.equal(h.subscriptions.length, 2);
  });
}

test("pusher: D74 task lookup independently scopes the row even if the later board gate allows", async () => {
  for (const enforce of [true, false]) {
    const h = harness({ area: "pusher", enforce, bypassBoardGate: true });
    assert.equal((await h.request()).status, enforce ? 403 : 200);
    assert.equal(h.queries.filter(query => query.model === "task").length, 1);
    assert.equal(h.subscriptions.length, enforce ? 0 : 1);
  }
});

for (const kind of ["private-project", "private-time-project", "private-task", "private-time-task"]) {
  test(`pusher: ${kind} transports authenticated agent to the board gate, including WATCH`, async () => {
    for (const enforce of [true, false]) {
      const h = harness({ area: "pusher", enforce });
      const channel = `${kind}-${kind.endsWith("task") ? h.task.id : h.project.id}`;
      assert.equal((await h.request({ channel_name: channel })).status, enforce ? 403 : 200);
    }
  });
}

for (const options of [{ actor: "outsider" }, { actor: "owner", teamless: true }]) {
  test(`pusher: inaccessible boards cannot authorize board/time/task channels ${JSON.stringify(options)}`, async () => {
    const h = harness({ area: "pusher", ...options });
    for (const channel of [`private-project-${h.project.id}`, `private-time-project-${h.project.id}`, `private-task-${h.task.id}`, `private-time-task-${h.task.id}`]) assert.equal((await h.request({ channel_name: channel })).status, 403);
    assert.deepEqual(h.subscriptions, []);
  });
}

test("pusher: missing task, archived board and anonymous session never reach the signer", async () => {
  const missing = harness({ area: "pusher", actor: "owner" });
  assert.equal((await missing.request({ channel_name: "private-task-999" })).status, 403);
  const archived = harness({ area: "pusher", actor: "owner" });
  archived.project.status = "Archive";
  assert.equal((await archived.request()).status, 403);
  const anonymous = harness({ area: "pusher", authenticated: false });
  for (const channel_name of ["private-user-6", "private-feature-flags", "private-task-21280"]) assert.equal((await anonymous.request({ channel_name })).status, 403);
  for (const h of [missing, archived, anonymous]) assert.deepEqual(h.subscriptions, []);
});

test("HTTP tagged agent cookies remain refused on all N09 methods in WATCH and ENFORCE", async () => {
  const { harness: proxyHarness } = require("./helpers/agent-cookie-bridge.cjs");
  for (const enforce of [false, true]) {
    const h = proxyHarness({ enforce });
    for (const [method, pathname] of [["POST", "/api/demo/guest"], ["POST", "/api/learn/board"], ["GET", "/api/slack/installation"], ["PATCH", "/api/slack/installation"], ["DELETE", "/api/slack/installation"], ["POST", "/api/pusher/auth"]]) {
      for (const bearer of [false, true]) {
        const response = await h.proxy(h.request(pathname, { method, bearer }));
        assert.equal(response.status, 403);
        assert.equal((await response.json()).code, "AGENT_COOKIE_ROUTE");
      }
    }
    assert.equal(h.calls.flags, 0);
  }
});
