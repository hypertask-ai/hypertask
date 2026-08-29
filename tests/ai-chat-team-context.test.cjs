const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  delete require.cache[filename];
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function loadContextModule(prisma, getProjectWhere = () => ({})) {
  const helperPath = "src/app/api/ai/_lib/chatTeamContext.ts";
  delete require.cache[path.join(root, helperPath)];
  stubModule("src/lib/prisma.ts", { default: prisma });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere,
  });
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-chat-team-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
    },
  );
  return jiti(path.join(root, helperPath));
}

function loadResolver(prisma, getProjectWhere = () => ({})) {
  return loadContextModule(prisma, getProjectWhere).resolveChatTeamContext;
}

test("untrusted request identifiers cannot reach provider or plan lookup", () => {
  const { buildChatProviderContext } = loadContextModule({});

  assert.equal(buildChatProviderContext(6, null, 999), null);
  assert.equal(buildChatProviderContext(6, null, undefined, "foreign-team"), null);
  assert.deepEqual(buildChatProviderContext(6, null), {
    planGateProjectId: null,
    keyLookupContext: { userId: 6 },
  });
});

test("resolved session board reaches provider and plan lookup", () => {
  const { buildChatProviderContext } = loadContextModule({});
  const resolvedContext = {
    teamId: "session-team",
    projectId: 73,
    aiProviderSettings: null,
  };

  assert.deepEqual(
    buildChatProviderContext(6, resolvedContext, 73),
    {
      planGateProjectId: 73,
      keyLookupContext: { trustedTeamId: "session-team", userId: 6 },
    },
  );
});

test("explicit accessible project remains the first chat billing context", async () => {
  const resolveChatTeamContext = loadResolver({
    project: {
      findFirst: async () => ({
        id: 42,
        teamId: "project-team",
        team: { aiProviderSettings: { openai: true } },
      }),
    },
    team: {
      findFirst: async () => assert.fail("project must win"),
    },
  });

  assert.deepEqual(
    await resolveChatTeamContext({ userId: 6, requestedProjectId: 42 }),
    {
      teamId: "project-team",
      projectId: 42,
      aiProviderSettings: { openai: true },
    },
  );
});

test("accessible team cannot hide an inaccessible requested project", async () => {
  const resolveChatTeamContext = loadResolver({
    project: { findFirst: async () => null },
    team: {
      findFirst: async () => ({
        id: "project-team",
        aiProviderSettings: null,
      }),
    },
  });

  assert.equal(
    await resolveChatTeamContext({
      userId: 6,
      requestedProjectId: 999,
      requestedTeamId: "project-team",
    }),
    null,
  );
});

test("accessible project cannot hide an inaccessible requested team", async () => {
  const resolveChatTeamContext = loadResolver({
    project: {
      findFirst: async () => ({
        id: 42,
        teamId: "project-team",
        team: { aiProviderSettings: null },
      }),
    },
    team: { findFirst: async () => null },
  });

  assert.equal(
    await resolveChatTeamContext({
      userId: 6,
      requestedProjectId: 42,
      requestedTeamId: "foreign-team",
    }),
    null,
  );
});

test("invalid explicit team does not fall back to another account team", async () => {
  let queries = 0;
  const resolveChatTeamContext = loadResolver({
    team: {
      findFirst: async ({ where }) => {
        assert.equal(where.id, "foreign-team");
        queries += 1;
        return null;
      },
    },
  });

  assert.equal(
    await resolveChatTeamContext({
      userId: 6,
      requestedTeamId: "foreign-team",
    }),
    null,
  );
  assert.equal(queries, 1);
});

test("global chat reuses the session's accessible project team", async () => {
  const resolveChatTeamContext = loadResolver(
    {
      chatSession: {
        findFirst: async () => ({ projectId: 73, agentId: null }),
      },
      project: {
        findFirst: async ({ where }) => {
          assert.equal(where.id, 73);
          assert.equal(where.accessFor, 6);
          return {
            id: 73,
            teamId: "session-team",
            team: { aiProviderSettings: null },
          };
        },
      },
    },
    (userId) => ({ accessFor: userId }),
  );

  assert.deepEqual(
    await resolveChatTeamContext({ userId: 6, sessionId: "session-1" }),
    {
      teamId: "session-team",
      projectId: 73,
      aiProviderSettings: null,
    },
  );
});

test("new global chat uses the strongest team across ownership and memberships", async () => {
  const resolveChatTeamContext = loadResolver({
    chatSession: {
      findFirst: async () => ({ projectId: null, agentId: null }),
    },
    team: {
      findMany: async ({ where, orderBy }) => {
        assert.deepEqual(where, {
          OR: [
            { googleAccount: { userId: 6 } },
            { members: { some: { userId: 6, status: "Accepted" } } },
          ],
        });
        assert.deepEqual(orderBy, { createdAt: "desc" });
        return [
          {
            id: "newest-free-owned-team",
            aiProviderSettings: { aiChat: "free" },
            activeSubscriptionPlanId: null,
            compedUntil: null,
            subscriptionPlan: [],
          },
          {
            id: "paid-member-team",
            aiProviderSettings: { aiChat: "paid" },
            activeSubscriptionPlanId: "sub-paid",
            compedUntil: null,
            subscriptionPlan: [
              {
                subscriptionId: "sub-paid",
                subscriptionStatus: "active",
                priceId: "price_1TMlqDIhmcH60VccRZGW1xK3",
              },
            ],
          },
        ];
      },
    },
  });

  assert.deepEqual(
    await resolveChatTeamContext({ userId: 6, sessionId: "session-2" }),
    {
      teamId: "paid-member-team",
      projectId: null,
      aiProviderSettings: { aiChat: "paid" },
    },
  );
});

test("native agent board survives invalid page context without account fallback", async () => {
  let projectQueries = 0;
  const resolveChatTeamContext = loadResolver({
    chatSession: {
      findFirst: async () => ({ projectId: null, agentId: "agent-1" }),
    },
    project: {
      findFirst: async () =>
        ++projectQueries === 1
          ? null
          : { teamId: "agent-team", team: { aiProviderSettings: null } },
    },
    team: {
      findFirst: async () => assert.fail("agent cannot use account fallback"),
    },
  });

  assert.deepEqual(
    await resolveChatTeamContext({
      userId: 6,
      sessionId: "native-session",
      requestedProjectId: 999,
    }),
    { teamId: "agent-team", projectId: null, aiProviderSettings: null },
  );
});
