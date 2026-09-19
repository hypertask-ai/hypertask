const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const prismaPath = path.join(root, "src/lib/prisma.ts");
const originalPrisma = require.cache[prismaPath];
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: { default: {} },
};

const jiti = require("jiti")(
  path.join(root, "tests/management-key-team-scope.test.cjs"),
  {
    alias: { "@": path.join(root, "src") },
    cache: false,
    interopDefault: true,
  },
);
const { agentWithinTeamWhere, getManagementKeyTeam, listManagementKeyTeams } =
  jiti(path.join(root, "src/lib/mcp/managementKeyTeamScope.ts"));

test.after(() => {
  if (originalPrisma) require.cache[prismaPath] = originalPrisma;
  else delete require.cache[prismaPath];
});

test("team choices include owned and accepted member teams", async () => {
  let query;
  const database = {
    team: {
      findMany: async (args) => {
        query = args;
        return [
          {
            id: "team-a",
            title: "Alpha",
            googleAccount: { userId: 42 },
          },
          {
            id: "team-b",
            title: "Beta",
            googleAccount: { userId: 9 },
          },
        ];
      },
    },
  };

  assert.deepEqual(await listManagementKeyTeams(42, database), [
    { id: "team-a", title: "Alpha", isOwner: true },
    { id: "team-b", title: "Beta", isOwner: false },
  ]);
  assert.deepEqual(query.where.OR, [
    { googleAccount: { is: { userId: 42 } } },
    { members: { some: { userId: 42, status: "Accepted" } } },
  ]);
});

test("team lookup binds the exact accepted membership", async () => {
  let query;
  const database = {
    team: {
      findFirst: async (args) => {
        query = args;
        return {
          id: "team-b",
          title: null,
          googleAccount: { id: "owner-account-b", userId: 9 },
          managementKeyOwnerGeneration: 0,
          members: [
            { id: "membership-b", managementKeyAccessGeneration: 0 },
          ],
        };
      },
    },
  };

  assert.deepEqual(await getManagementKeyTeam(42, "team-b", database), {
    id: "team-b",
    title: null,
    isOwner: false,
    accessBinding: "member:membership-b:0",
  });
  assert.equal(query.where.id, "team-b");
  assert.deepEqual(query.where.OR, [
    { googleAccount: { is: { userId: 42 } } },
    { members: { some: { userId: 42, status: "Accepted" } } },
  ]);
  assert.deepEqual(query.select.members, {
    where: { userId: 42, status: "Accepted" },
    select: { id: true, managementKeyAccessGeneration: true },
    take: 1,
  });
});

test("owner bindings change after an ownership transfer generation advances", async () => {
  let generation = 0;
  const database = {
    team: {
      findFirst: async () => ({
        id: "team-a",
        title: "Alpha",
        googleAccount: { id: "owner-account-a", userId: 42 },
        managementKeyOwnerGeneration: generation,
        members: [],
      }),
    },
  };

  const original = await getManagementKeyTeam(42, "team-a", database);
  generation = 2;
  const returned = await getManagementKeyTeam(42, "team-a", database);

  assert.equal(original.accessBinding, "owner:owner-account-a:0");
  assert.equal(returned.accessBinding, "owner:owner-account-a:2");
  assert.notEqual(original.accessBinding, returned.accessBinding);
});

test("member bindings change after a membership grant generation advances", async () => {
  let generation = 0;
  const database = {
    team: {
      findFirst: async () => ({
        id: "team-b",
        title: "Beta",
        googleAccount: { id: "owner-account-b", userId: 9 },
        managementKeyOwnerGeneration: 0,
        members: [
          { id: "membership-b", managementKeyAccessGeneration: generation },
        ],
      }),
    },
  };

  const original = await getManagementKeyTeam(42, "team-b", database);
  generation = 2;
  const returned = await getManagementKeyTeam(42, "team-b", database);

  assert.equal(original.accessBinding, "member:membership-b:0");
  assert.equal(returned.accessBinding, "member:membership-b:2");
  assert.notEqual(original.accessBinding, returned.accessBinding);
});

test("the database advances owner grants whenever ownership changes", () => {
  const migration = readFileSync(
    path.join(
      root,
      "src/prisma/migrations/20260918143000_add_team_scoped_management_keys/migration.sql",
    ),
    "utf8",
  );

  assert.match(migration, /BEFORE UPDATE OF "googleAccountId" ON "Team"/);
  assert.match(
    migration,
    /NEW\."managementKeyOwnerGeneration" := OLD\."managementKeyOwnerGeneration" \+ 1/,
  );
  assert.match(migration, /AFTER UPDATE OF "userId" ON "GoogleAccount"/);
  assert.match(
    migration,
    /SET "managementKeyOwnerGeneration" = "managementKeyOwnerGeneration" \+ 1/,
  );
  assert.match(
    migration,
    /BEFORE UPDATE OF "status", "userId", "teamId" ON "Member_Team"/,
  );
  assert.match(
    migration,
    /NEW\."managementKeyAccessGeneration" := OLD\."managementKeyAccessGeneration" \+ 1/,
  );
});

test("agent scope excludes empty, teamless, and mixed-team agents", () => {
  assert.deepEqual(agentWithinTeamWhere("team-a"), {
    members: {
      some: { project: { teamId: "team-a" } },
      none: {
        project: {
          OR: [{ teamId: null }, { teamId: { not: "team-a" } }],
        },
      },
    },
  });
});
