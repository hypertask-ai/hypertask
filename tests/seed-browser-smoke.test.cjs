const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "scripts/seed-browser-smoke.mjs"), "utf8");
const start = source.indexOf("  if (allFlagsOn) {", source.indexOf("try {"));
const end = source.indexOf("  const flags =", start);

// Execute the real seed branch without starting a browser or touching a database.
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

test("contract callers and boards are isolated from the browser smoke user", async () => {
  const records = {};
  const files = {};
  const boards = [];
  let nextId = 100;
  const prisma = Object.fromEntries([
    "user", "userPicture", "user_Activity", "googleAccount", "team", "team_Activity", "member_Team", "member", "invite", "label",
  ].map(model => {
    records[model] = [];
    return [model, {
      create: async ({ data }) => {
        const row = { ...data, id: nextId++, ...(data.UserSetting ? { UserSetting: { id: nextId++ } } : {}) };
        records[model].push(row);
        return row;
      },
      createMany: async ({ data }) => { records[model].push(...data); },
      update: async ({ where, data }) => Object.assign(records[model].find(row => row.id === where.id), data),
      findUnique: async ({ where }) => records[model].find(row => row.id === where.id),
      count: async ({ where }) => records[model].filter(row => where.userId.in.includes(row.userId)).length,
    }];
  }));
  const seedStart = source.indexOf("async function seedSessionFixtures(flags) {");
  const seedEnd = source.indexOf("\ntry {", seedStart);
  assert.ok(seedStart >= 0 && seedEnd > seedStart);
  const run = new (Object.getPrototypeOf(async function () {}).constructor)(
    "prisma", "createBoard", "signSession", "SESSION_TTL_SECONDS", "path", "stateFile", "fixtureFile", "mkdir", "writeFile", "appendFile", "process", "randomUUID",
    `const runKey = "test", localPremerge = false, contractEnabled = true, visual = false, VISUAL_NOW = "2026-10-01T12:00:00Z";\n${source.slice(seedStart, seedEnd)}\nawait seedSessionFixtures({});`,
  );
  await run(prisma, async data => {
    const board = { ...data, id: nextId++, task: { id: nextId++, uniqueIndex: 1, title: data.title, updatedAt: new Date() }, columns: [] };
    boards.push(board);
    return board;
  }, payload => JSON.stringify(payload), 3600, path, "/fixtures/state.json", "/fixtures/card-fixture.json",
  async () => {}, async (file, content) => { files[file] = JSON.parse(content); }, async () => {},
  { env: { GITHUB_OUTPUT: "/fixtures/output" } }, () => "invite-key");

  const smoke = records.user.find(user => user.displayName === "Browser smoke user");
  const contract = files["/fixtures/contract-fixture.json"];
  const owner = contract.callers.owner;
  assert.notEqual(owner.id, smoke.id, "contract owner must not be the smoke user");
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
  assert.deepEqual(records.member_Team.filter(row => row.teamId === boards[0].teamId).map(row => row.userId), [smoke.id]);
});
