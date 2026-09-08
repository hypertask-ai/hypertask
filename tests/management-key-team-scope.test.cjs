const assert = require("node:assert/strict");
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
            googleAccount: { userId: 6 },
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

  assert.deepEqual(await listManagementKeyTeams(6, database), [
    { id: "team-a", title: "Alpha", isOwner: true },
    { id: "team-b", title: "Beta", isOwner: false },
  ]);
  assert.deepEqual(query.where.OR, [
    { googleAccount: { is: { userId: 6 } } },
    { members: { some: { userId: 6, status: "Accepted" } } },
  ]);
});

test("one-team lookup keeps the access predicate", async () => {
  let query;
  const database = {
    team: {
      findFirst: async (args) => {
        query = args;
        return {
          id: "team-b",
          title: null,
          googleAccount: { id: "owner-account-b", userId: 9 },
          members: [{ id: "membership-b" }],
        };
      },
    },
  };

  assert.deepEqual(await getManagementKeyTeam(6, "team-b", database), {
    id: "team-b",
    title: null,
    isOwner: false,
    accessBinding: "member:membership-b",
  });
  assert.equal(query.where.id, "team-b");
  assert.deepEqual(query.where.OR, [
    { googleAccount: { is: { userId: 6 } } },
    { members: { some: { userId: 6, status: "Accepted" } } },
  ]);
  assert.deepEqual(query.select.members, {
    where: { userId: 6, status: "Accepted" },
    select: { id: true },
    take: 1,
  });
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
