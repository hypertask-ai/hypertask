const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

// HTPR-7164: creating a board must not attach it to a team the caller does not belong to.
const teams = [
  { id: "own", googleAccountId: "acct-own", ownerUserId: 6, members: [] },
  { id: "joined", googleAccountId: "acct-joined", ownerUserId: 7, members: [{ userId: 6, status: "Accepted" }] },
  { id: "invited", googleAccountId: "acct-invited", ownerUserId: 8, members: [{ userId: 6, status: "Pending" }] },
  { id: "other", googleAccountId: "acct-other", ownerUserId: 9, members: [] },
];

function matchesTeam(team, where) {
  if (team.id !== where.id) return false;
  return where.OR.some(rule =>
    (rule.googleAccountId && rule.googleAccountId === team.googleAccountId) ||
    (rule.googleAccount && rule.googleAccount.is.userId === team.ownerUserId) ||
    (rule.members && team.members.some(m => m.userId === rule.members.some.userId && m.status === rule.members.some.status)));
}

function controller(user = { id: 6, accountId: "acct-own" }) {
  let created = null;
  const prisma = {
    user: { findUnique: async () => user },
    team: { findFirst: async ({ where }) => teams.find(team => matchesTeam(team, where)) ?? null },
    project: {
      findFirst: async () => null,
      create: async ({ data }) => { created = { ...data, id: 15 }; return created; },
      update: async ({ data }) => ({ ...created, ...data, owner: { displayName: "User" }, team: { title: "Team" } }),
    },
    project_View: { upsert: async () => ({ default_view_id: 1 }) },
    $executeRaw: async () => {},
    $transaction: async callback => callback(prisma),
  };
  const create = load("src/utils/controllers/projects/create.ts", {
    "@/lib/telemetry/activationOccurrences": { captureActivationOccurrence: async () => null },
    "@/lib/telemetry/savedWork": { enqueueBoardCreated: async () => "board_created:1", processAnalyticsIntentSoon: () => {} },
    "@/lib/prisma": { default: prisma },
    "../logs/createLog": { default: () => {} },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/lib/projectPrefix": { normalizeProjectPrefix: value => value },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {},
    "@/utils/helperFunctions/Views/FilterHelperFunctions": {},
    "./boardQuota": { isBoardLimitReached: async () => false },
  }).default;
  return { create, created: () => created };
}

test("an outsider cannot create a board in another team", async () => {
  const f = controller();
  const result = await f.create(6, "Board", "other", "acct-other", "BRD");
  assert.equal(result.status, 403);
  assert.equal(f.created(), null);
});

test("a pending invite is not enough to create a board", async () => {
  const f = controller();
  assert.equal((await f.create(6, "Board", "invited", "acct-invited", "BRD")).status, 403);
  assert.equal(f.created(), null);
});

test("the team owner and accepted members can still create boards", async () => {
  for (const [user, teamId, account] of [
    [{ id: 6, accountId: "acct-own" }, "own", "acct-own"],
    [{ id: 6, accountId: null }, "own", "acct-own"],
    [{ id: 6, accountId: "acct-own" }, "joined", "acct-joined"],
  ]) {
    const f = controller(user);
    assert.equal((await f.create(6, "Board", teamId, account, "BRD")).status, 200);
    assert.equal(f.created().teamId, teamId);
    assert.equal(f.created().googleAccountId, account);
  }
});

test("the board takes the team's account, not the one in the request", async () => {
  const f = controller();
  assert.equal((await f.create(6, "Board", "joined", "acct-other", "BRD")).status, 200);
  assert.equal(f.created().googleAccountId, "acct-joined");
});
