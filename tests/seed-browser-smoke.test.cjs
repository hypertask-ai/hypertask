const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "scripts/seed-browser-smoke.mjs"), "utf8");
const start = source.indexOf("  if (allFlagsOn) {", source.indexOf("try {"));
const end = source.indexOf("  const flags =", start);

test("local browser smoke persists per-flag defaults and respects flag overrides", async () => {
  assert.ok(start >= 0 && end > start);
  const { localFlagModes } = await import("../scripts/premerge-local-flags.mjs");
  const defaults = { feature: "OWNER_AND_QA", bugfix: "EVERYONE", explicit: "OFF", owner: "OWNER_ONLY", released: "OFF" };
  for (const overrides of [[], ["--flag", "bugfix=OFF", "--flag", "explicit=OWNER_AND_QA"]]) {
    const stored = {};
    let saved;
    let invalidations = 0;
    const run = new (Object.getPrototypeOf(async function () {}).constructor)(
      "jiti", "path", "root", "process", "localFlagModes", "readPlainQaFlags", "QA_ACCOUNT_STATE", "writeFile", "stateFile", "prisma", "withFlagModeInvalidation",
      `const allFlagsOn = false, liveLikeControl = false, localPremerge = true; let modes = {};\n${source.slice(start, end)}\nreturn modes;`,
    );
    const modes = await run(
      () => ({ FEATURE_FLAG_KEYS: Object.keys(defaults), defaultFeatureFlagMode: key => defaults[key] }),
      path, root, { argv: ["node", "seed-browser-smoke.mjs", ...overrides] }, localFlagModes,
      async state => state === "qa-account-state" ? {} : ({ released: true, bugfix: false }), "qa-account-state",
      async (_file, content) => { saved = JSON.parse(content).modes; }, path.join(root, "e2e/smoke/.state/test/state.json"),
      { featureFlag: { upsert: async ({ where, create, update }) => {
        assert.equal(create.key, where.key);
        assert.equal(create.mode, update.mode);
        stored[where.key] = create.mode;
      } } },
      async write => { invalidations++; return write(); },
    );
    assert.equal(invalidations, 1);
    assert.deepEqual(modes, {
      ...defaults, released: "EVERYONE",
      ...(overrides.length ? { bugfix: "OFF", explicit: "OWNER_AND_QA" } : {}),
    });
    assert.deepEqual(stored, modes);
    assert.deepEqual(saved, modes);
  }
});

test("browser smoke users and contract callers stay isolated", async () => {
  const records = {};
  const files = {};
  const boards = [];
  let nextId = 100;
  const prisma = Object.fromEntries([
    "user", "userPicture", "user_Activity", "googleAccount", "team", "team_Activity", "member_Team", "member", "invite", "label", "agent", "chatSession", "chatMessage",
  ].map(model => {
    records[model] = [];
    return [model, {
      create: async ({ data }) => {
        const row = { ...data, id: nextId++, ...(data.UserSetting ? { UserSetting: { ...data.UserSetting.create, id: nextId++ } } : {}) };
        records[model].push(row);
        return row;
      },
      createMany: async ({ data }) => { records[model].push(...data); },
      update: async ({ where, data }) => {
        const index = records[model].findIndex(row => Object.entries(where).every(([key, value]) => row[key] === value));
        return records[model][index] = { ...records[model][index], ...data };
      },
      findUnique: async ({ where }) => records[model].find(row => row.id === where.id),
      count: async ({ where }) => records[model].filter(row => where.userId.in.includes(row.userId)).length,
    }];
  }));
  const seedStart = source.indexOf("async function seedSessionFixtures(flags) {");
  const seedEnd = source.indexOf("\ntry {", seedStart);
  assert.ok(seedStart >= 0 && seedEnd > seedStart);
  const run = new (Object.getPrototypeOf(async function () {}).constructor)(
    "prisma", "createBoard", "signSession", "SESSION_TTL_SECONDS", "path", "stateFile", "fixtureFile", "mkdir", "writeFile", "appendFile", "process", "randomUUID", "jiti", "root",
    `const runKey = "test", localPremerge = false, contractEnabled = true, visual = false, VISUAL_NOW = "2026-10-01T12:00:00Z";
${source.slice(seedStart, seedEnd)}
await seedSessionFixtures({});`,
  );
  await run(prisma, async data => {
    const board = { ...data, id: nextId++, task: { id: nextId++, uniqueIndex: 1, title: data.title, updatedAt: new Date() }, columns: [] };
    boards.push(board);
    return board;
  }, payload => JSON.stringify(payload), 3600, path, "/fixtures/state.json", "/fixtures/card-fixture.json",
  async () => {}, async (file, content) => { files[file] = JSON.parse(content); }, async () => {},
  { argv: [], env: { GITHUB_OUTPUT: "/fixtures/output" } }, () => "invite-key", (file) => {
    assert.equal(file, path.join(root, "src/lib/mcp/auth/verifyJwt.ts"));
    return {
      createMcpToken: (userId, _email, _ttl, agentId) => `${userId}:${agentId}`,
      agentTokenCredentialFields: (token) => ({ mcpTokenHash: `hash:${token}` }),
    };
  }, root);

  const smoke = records.user.find(user => user.displayName === "Browser smoke user");
  const scopeUsers = ["Desktop", "Mobile"].map(lane => {
    const state = files[`/fixtures/board-scope-${lane}-state.json`];
    assert.ok(state, `${lane} board-scope checks need their own login`);
    const id = JSON.parse(state.cookies.find(cookie => cookie.name === "ht_session").value).id;
    const user = records.user.find(row => row.id === id);
    assert.notEqual(id, smoke.id);
    assert.equal(user.displayName, `Board scope ${lane}`);
    assert.equal(user.UserSetting.aiChatOpenBoards, true);
    const persisted = JSON.parse(state.origins[0].localStorage.find(item => item.name === "recoil-persist").value);
    assert.equal(state.origins[0].origin, "http://127.0.0.1:3100");
    assert.equal(persisted.aiChatAutoOpenPreferences[id].aiChatOpenBoards, true);
    const scopeBoards = files["/fixtures/board-scope-fixture.json"];
    assert.equal(scopeBoards.length, 2);
    assert.equal(state.cookies.find(cookie => cookie.name === "previousBoard").value, `project-${scopeBoards[0].id}|&|`);
    for (const board of scopeBoards) {
      const project = boards.find(row => row.id === board.id);
      assert.notEqual(project.teamId, boards[0].teamId);
      assert.ok(project.ownerId === id || records.member.some(row => row.userId === id && row.projectId === board.id && row.status === "Accepted"));
      assert.ok(!records.member.some(row => row.userId === smoke.id && row.projectId === board.id));
    }
    assert.ok(records.user_Activity.some(row => row.userId === id));
    return id;
  });
  assert.equal(new Set(scopeUsers).size, 2);
  const card = files["/fixtures/card-fixture.json"];
  assert.deepEqual(Object.keys(card.pages), ["Desktop", "Mobile"]);
  const pagesBoards = Object.values(card.pages).map(fixture => fixture.projectId);
  assert.equal(new Set(pagesBoards).size, 2, "parallel Pages tests need separate boards");
  for (const [lane, fixture] of Object.entries(card.pages)) {
    const board = boards.find(board => board.id === fixture.projectId);
    assert.equal(board.title, `Browser smoke Pages ${lane}`);
    assert.notEqual(board.ownerId, smoke.id);
    assert.notEqual(board.teamId, boards[0].teamId);
    const state = files[`/fixtures/pages-${lane}-state.json`];
    const id = JSON.parse(state.cookies.find(cookie => cookie.name === "ht_session").value).id;
    assert.equal(id, board.ownerId);
    const sessionUser = JSON.parse(decodeURIComponent(state.cookies.find(cookie => cookie.name === "nookies_user").value));
    assert.equal(sessionUser.accountId, board.googleAccountId);
    assert.equal(sessionUser.UserSettingId, sessionUser.UserSetting.id);
    assert.equal(state.cookies.find(cookie => cookie.name === "previousBoard").value, `project-${board.id}|&|`);
    assert.ok(records.user_Activity.some(row => row.userId === id));
    assert.ok(records.member_Team.some(row => row.userId === id && row.teamId === board.teamId));
    assert.ok(!records.member_Team.some(row => row.userId === smoke.id && row.teamId === board.teamId));
    assert.equal(fixture.taskId, board.task.id);
    assert.equal(fixture.detailPath, `/detail/project-${board.id}/${board.task.uniqueIndex}`);
    assert.notEqual(fixture.taskId, card.taskId, "Pages links must not push down the layout fixture's comments");
  }
  const contract = files["/fixtures/contract-fixture.json"];
  const owner = contract.callers.owner;
  assert.notEqual(owner.id, smoke.id, "contract owner must not be the smoke user");
  const sidebar = files["/fixtures/agent-sidebar-fixture.json"];
  let activityUserId;
  const load = require('./helpers/htpr-7260-ui.cjs').loader({
    '@/lib/prisma': { default: prisma },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: activityUserId }) },
    '@/utils/controllers/teams/hasTeamMembershipAccess': { hasTeamMembershipAccess: async () => true },
  });
  const activity = load('src/pages/api/activity/addLastActiveAt.ts').default;
  const statuses = {};
  for (const lane of ['Desktop', 'Mobile']) {
    activityUserId = records.user.find(user => user.displayName === `Sidebar ${lane}`).id;
    let body;
    const response = { status: code => { statuses[lane] = code; return response; }, json: value => { body = value; } };
    await activity({ method: 'POST', headers: {}, body: { userId: activityUserId } }, response);
    assert.equal(statuses[lane], 200, `${lane} sidebar fixture must support the real board activity endpoint`);
    assert.equal(body.userId, activityUserId);
    assert(body.lastActiveAt instanceof Date);
    assert.equal(body.totalTeamsOwned, 0);
  }
  assert.equal(sidebar.projectId, boards[0].id);
  assert.deepEqual(Object.keys(sidebar.lanes), ["Desktop", "Mobile"]);
  assert.deepEqual(sidebar.personalChats.map(chat => chat.title), ["Desktop", "Mobile"].flatMap(lane =>
    [`Smoke ${lane} chat: planning`, `Smoke${lane}${"1792812226726848138aiChatOpenNewTickets".repeat(6)}`, `Smoke ${lane} chat: next steps`]));
  assert.deepEqual(sidebar.personalChats.map(chat => chat.updatedAt), ["Desktop", "Mobile"].flatMap(() =>
    ["2026-10-22T10:00:00.000Z", "2026-10-22T11:00:00.000Z", "2026-10-22T12:00:00.000Z"]));
  assert.equal(new Set(sidebar.personalChats.map(chat => chat.id)).size, 6);
  assert.equal(new Set(sidebar.personalChats.map(chat => chat.message)).size, 6);
  for (const fixture of sidebar.personalChats) {
    const session = records.chatSession.find(row => row.id === fixture.id);
    assert.equal(session.userId, records.user.find(user => user.displayName === `Sidebar ${fixture.lane}`).id);
    assert.equal(session.agentId, null);
    assert.equal(session.taskId, null);
    assert.equal(session.projectId, sidebar.projectId);
    assert.equal(session.title, fixture.title);
    assert.equal(session.updatedAt.toISOString(), fixture.updatedAt);
    const history = records.chatMessage.filter(row => row.sessionId === fixture.id);
    assert.equal(history.length, 1);
    assert.equal(history[0].role, "assistant");
    assert.equal(history[0].content, fixture.message);
  }
  for (const [lane, agents] of Object.entries(sidebar.lanes)) {
    assert.deepEqual(agents.map(agent => agent.name), ["A", "B", "Native"].map(suffix => `Sidebar ${lane} ${suffix}`));
    for (const fixture of agents) {
      const agent = records.agent.find(row => row.id === fixture.id);
      assert.equal(agent.userId, records.user.find(user => user.displayName === `Sidebar ${lane}`).id);
      assert.equal(agent.runtimeType, fixture.name.endsWith("Native") ? "NATIVE" : "EXTERNAL");
      assert.equal(agent.mcpTokenHash, `hash:${fixture.token}`);
      assert.ok(records.member.some(row => row.agentId === agent.id && row.projectId === sidebar.projectId && row.status === "Accepted"));
      assert.ok(records.chatSession.some(row => row.id === fixture.sessionId && row.agentId === agent.id && row.teamId === boards[0].teamId));
      const history = records.chatMessage.filter(row => row.sessionId === fixture.sessionId);
      assert.equal(history.length, 30);
      assert.equal(history[0].content, `${fixture.name} history 1`);
    }
  }
  const ownerUser = records.user.find(user => user.id === owner.id);
  const account = records.googleAccount.find(row => row.userId === owner.id);
  const team = records.team.find(row => row.googleAccountId === account.id);
  assert.notEqual(team.id, boards[0].teamId);
  assert.equal(ownerUser.accountId, account.id);
  assert.ok(records.team_Activity.some(row => row.teamId === team.id));
  assert.ok(records.user_Activity.some(row => row.userId === owner.id && row.totalTeamsOwned === 1));
  for (const id of [owner.id, contract.callers.member.id]) {
    assert.ok(records.member_Team.some(row => row.userId === id && row.teamId === team.id && row.googleAccountId === account.id && row.status === "Accepted" && row.acceptedAt));
  }
  for (const caller of Object.values(contract.callers)) {
    assert.notEqual(caller.id, smoke.id);
    assert.equal(JSON.parse(caller.cookies.find(cookie => cookie.name === "ht_session").value).id, caller.id);
    const sessionUser = JSON.parse(decodeURIComponent(caller.cookies.find(cookie => cookie.name === "nookies_user").value));
    assert.equal(sessionUser.id, caller.id);
    assert.ok(sessionUser.UserSettingId);
    if (caller === owner) assert.equal(sessionUser.accountId, account.id);
  }
  assert.equal(contract.boards.length, 2);
  for (const project of boards.filter(board => contract.boards.some(row => row.id === board.id))) {
    assert.equal(project.ownerId, owner.id);
    assert.equal(project.teamId, team.id);
    assert.equal(project.googleAccountId, account.id);
    const members = records.member.filter(row => row.projectId === project.id);
    assert.deepEqual(members.map(row => row.userId).sort(), [contract.callers.member.id, contract.callers.guest.id].sort());
    assert.ok(members.every(row => row.status === "Accepted"));
    assert.ok(records.invite.filter(row => row.projectId === project.id).every(row => row.userId === owner.id));
  }
  assert.ok(records.member_Team.filter(row => [contract.callers.guest.id, contract.callers.unaccepted.id].includes(row.userId)).length === 0);
  assert.deepEqual(records.member_Team.filter(row => row.teamId === boards[0].teamId).map(row => row.userId), [smoke.id, ...records.user.filter(user => user.displayName.startsWith("Sidebar ")).map(user => user.id)]);
});


test("opt-in journeys get a private seeded board without depending on Free plan board creation", async () => {
  const start = source.indexOf('  if (process.argv.includes("--qa-journeys")) {');
  const end = source.indexOf("  const sessionUser =", start);
  assert.ok(start >= 0 && end > start);
  const run = new (Object.getPrototypeOf(async function () {}).constructor)(
    "process", "createBoard",
    `const user = { id: 123 }, team = { id: 456 }, googleAccount = { id: 789 };
${source.slice(start, end)}`,
  );
  for (const argv of [[], ["--qa-journeys"]]) {
    const boards = [];
    await run({ argv }, async data => { boards.push(data); });
    assert.deepEqual(boards, argv.length ? [{
      ownerId: 123, teamId: 456, googleAccountId: 789, title: "QA runner board", suffix: "qa",
    }] : []);
  }
});
