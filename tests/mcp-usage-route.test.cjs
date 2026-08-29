const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TEAM_ID = "22222222-2222-4222-8222-222222222222";
const regularBearerToken = ["regular", "bearer", "fixture"].join("-");
let entry = 0;
const loadGatewayUsage = require("jiti")(
  path.join(root, "tests/mcp-usage-route.test.cjs"),
  {
    alias: { "@": path.join(root, "src") },
    cache: false,
    interopDefault: true,
  },
);
const {
  gatewayBillingPeriodRange: realGatewayBillingPeriodRange,
} = loadGatewayUsage(
  path.join(root, "src/app/api/settings/ai-usage/gatewayUsage.ts"),
);
const TEST_PERIOD = realGatewayBillingPeriodRange(
  new Date("2026-08-21T12:00:00.000Z"),
);

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function clearModule(relativePath) {
  delete require.cache[path.join(root, relativePath)];
}

function loadRoute({
  aggregateGatewayUsage,
  authContext,
  funding,
  gatewayResponse,
  onFunding,
  onGateway,
  prisma,
  getProjectWhere = () => ({}),
  rateLimitResponse = null,
  authBoundary = false,
}) {
  const stubbedModules = [
    "src/app/api/mcp/ai/usage/route.ts",
    "src/lib/mcp/auth.ts",
    "src/app/api/ai/_lib/byokKeys.ts",
    "src/app/api/settings/ai-usage/gatewayUsage.ts",
    "src/lib/prisma.ts",
    "src/utils/controllers/projects/getAllIncludes.ts",
    "src/lib/redis.ts",
    "src/lib/auth/betterAuth.ts",
    "src/lib/auth/getSessionUser.ts",
    "src/utils/controllers/logs/createLog.ts",
  ];
  const originalCache = new Map(Object.entries(require.cache));
  stubbedModules.forEach(clearModule);

  if (authBoundary) {
    const authKeyPermissions = {
      "htmk_usage-test": { usage: ["read"] },
      "htmk_management-test": { management: ["read", "write"] },
      "htmk_legacy-test": {
        management: ["read", "write"],
        data: ["read", "write"],
      },
      "htmk_data-test": {
        management: ["read", "write"],
        data: ["read", "write"],
        usage: [],
      },
    };
    stubModule("src/lib/auth/betterAuth.ts", {
      auth: {
        api: {
          verifyApiKey: async ({ body }) => {
            const permissions = authKeyPermissions[body.key];
            return {
              valid: Boolean(permissions),
              key: permissions
                ? { id: 1, referenceId: "6", permissions }
                : null,
            };
          },
        },
      },
    });
    stubModule("src/lib/redis.ts", {
      getRedis: async () => ({
        incr: async () => 1,
        expire: async () => 1,
      }),
    });
    stubModule("src/lib/auth/getSessionUser.ts", {
      getSessionUser: async () => null,
    });
    stubModule("src/utils/controllers/logs/createLog.ts", {
      default: async () => {},
    });
  } else {
    stubModule("src/lib/mcp/auth.ts", {
      checkMcpRateLimit: async () => rateLimitResponse,
      extractBearerToken: (header) => header?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null,
      isManagementKeyToken: (token) => token.startsWith("htmk_"),
      validateMcpAuth: async () => authContext,
    });
  }
  stubModule("src/app/api/ai/_lib/byokKeys.ts", {
    getTeamGatewayFunding: async (lookup) => {
      onFunding?.(lookup);
      return funding;
    },
  });
  stubModule("src/app/api/settings/ai-usage/gatewayUsage.ts", {
    aggregateGatewayTeamUsage:
      aggregateGatewayUsage ?? (() => ({ totalCost: 0.42 })),
    gatewayBillingPeriodRange: () => TEST_PERIOD,
    gatewayGet: async (requestPath, apiKey, options) => {
      onGateway?.({ apiKey, requestPath, ...options });
      return gatewayResponse;
    },
  });
  stubModule("src/lib/prisma.ts", { default: prisma });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere,
  });

  const restore = () => {
    for (const filename of Object.keys(require.cache)) {
      if (!originalCache.has(filename)) delete require.cache[filename];
    }
    for (const [filename, original] of originalCache) {
      require.cache[filename] = original;
    }
  };

  try {
    const jiti = require("jiti")(
      path.join(root, `tests/mcp-usage-route-entry-${++entry}.cjs`),
      {
        alias: { "@": path.join(root, "src") },
        cache: false,
        interopDefault: true,
      },
    );

    const route = jiti(path.join(root, "src/app/api/mcp/ai/usage/route.ts"));
    return { route, restore };
  } catch (error) {
    restore();
    throw error;
  }
}

function request(
  search = `?team_id=${TEAM_ID}`,
  token = "htmk_usage-test",
  scheme = "Bearer",
) {
  const headers =
    token === null ? {} : { Authorization: `${scheme} ${token}` };
  return new NextRequest(`https://app.hypertask.ai/api/mcp/ai/usage${search}`, {
    headers,
  });
}

function prismaFixture({
  aggregateError = false,
  owner = true,
  revokeOwnerAfterUsageSnapshot = false,
  ownedTeams = [{ id: TEAM_ID }],
  teamExists = true,
  teamFindFirstError = false,
  teamFindManyError = false,
  projectAccessible = true,
  expectedProjectAccess = null,
  expectedUserId = 6,
  userRecord = {
    displayName: "Owner",
    email: "owner@example.test",
    id: 6,
  },
} = {}) {
  const expectedOwnerFilter = { userId: expectedUserId };
  let transactionOwner;
  let transactionCount = 0;
  const visibleOwner = () => transactionOwner ?? owner;
  const fixture = {
    user: {
      findUnique: async (args) => {
        fixture.userFindUniqueArgs = args;
        assert.equal(args.where.id, expectedUserId);
        return userRecord;
      },
    },
    team: {
      findMany: async (args) => {
        fixture.teamFindManyArgs = args;
        if (teamFindManyError) throw new Error("team list unavailable");
        assert.deepEqual(args.where.googleAccount, expectedOwnerFilter);
        return owner ? ownedTeams : [];
      },
      findFirst: async (args) => {
        fixture.teamFindFirstArgs = args;
        if (teamFindFirstError) throw new Error("team lookup unavailable");
        assert.deepEqual(args.where.googleAccount, expectedOwnerFilter);
        const isOwnedTeam = ownedTeams.some(
          (ownedTeam) => ownedTeam.id === args.where.id,
        );
        if (!teamExists || !visibleOwner() || !isOwnedTeam) return null;
        return { id: args.where.id };
      },
    },
    project: {
      findFirst: async (args) => {
        fixture.projectFindFirstArgs = args;
        if (expectedProjectAccess) {
          assert.deepEqual(args.where, {
            id: args.where.id,
            ...expectedProjectAccess,
          });
        }
        if (!projectAccessible) return null;
        return { id: args.where.id };
      },
    },
    aiUsage: {
      aggregate: async (args) => {
        fixture.aggregateCalls = (fixture.aggregateCalls ?? 0) + 1;
        fixture.aggregateArgs = args;
        if (aggregateError) throw new Error("aggregate unavailable");
        return {
          _count: { _all: 3 },
          _sum: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
        };
      },
      groupBy: async (args) => {
        fixture.groupByArgs = args;
        return [
          {
            model: "gpt-5",
            _count: { _all: 2 },
            _sum: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
          },
        ];
      },
    },
  };
  fixture.$transaction = async (operation, options) => {
    const previousTransactionOwner = transactionOwner;
    transactionOwner = owner;
    const transactionNumber = transactionCount++;
    fixture.transactionOptions = options;
    try {
      const result = await operation(fixture);
      if (revokeOwnerAfterUsageSnapshot && transactionNumber === 0) {
        owner = false;
      }
      return result;
    } finally {
      transactionOwner = previousTransactionOwner;
    }
  };
  fixture.$queryRaw = async (template, teamIdValue, userIdValue) => {
    fixture.queryRawArgs = { teamId: teamIdValue, userId: userIdValue };
    assert.equal(userIdValue, expectedUserId);
    const isOwnedTeam = ownedTeams.some(
      (ownedTeam) => ownedTeam.id === teamIdValue,
    );
    if (!teamExists || !visibleOwner() || !isOwnedTeam) return [];
    return [{ id: teamIdValue }];
  };
  return fixture;
}

test("usage route returns only owner-scoped counts and spend", async () => {
  const prisma = prismaFixture();
  let aggregateCalls = 0;
  let gatewayRequest;
  let fundingLookup;
  const { route, restore } = loadRoute({
    aggregateGatewayUsage: (payload) => {
      aggregateCalls += 1;
      assert.deepEqual(payload, { results: [] });
      return { totalCost: 0.42 };
    },
    funding: { apiKey: "vck_test", source: "managed" },
    gatewayResponse: Response.json({ results: [] }),
    onFunding: (lookup) => {
      fundingLookup = lookup;
    },
    onGateway: (request) => {
      gatewayRequest = request;
    },
    prisma,
    authBoundary: true,
  });

  try {
    const response = await route.GET(request());
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      success: true,
      teamId: TEAM_ID,
      period: TEST_PERIOD,
      spendUsd: 0.42,
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        requests: 3,
        totalTokens: 150,
      },
    });
    assert.equal("plan" in body, false);
    assert.equal("fundingSource" in body, false);
    assert.equal("allowance" in body, false);
    assert.equal(prisma.aggregateArgs.where.teamId, TEAM_ID);
    assert.deepEqual(prisma.transactionOptions, {
      isolationLevel: "Serializable",
    });
    assert.equal(
      prisma.aggregateArgs.where.createdAt.gte.toISOString(),
      `${TEST_PERIOD.startDate}T00:00:00.000Z`,
    );
    assert.equal(
      prisma.aggregateArgs.where.createdAt.lte.toISOString(),
      `${TEST_PERIOD.endDate}T23:59:59.999Z`,
    );
    assert.equal(prisma.teamFindFirstArgs.where.id, TEAM_ID);
    assert.deepEqual(prisma.teamFindFirstArgs.where.googleAccount, {
      userId: 6,
    });
    assert.deepEqual(fundingLookup, { trustedTeamId: TEAM_ID });
    assert.deepEqual(prisma.queryRawArgs, {
      teamId: TEAM_ID,
      userId: 6,
    });
    assert.equal(aggregateCalls, 1);
    assert.equal(gatewayRequest.apiKey, "vck_test");
    assert.equal(gatewayRequest.maxBytes, 2 * 1024 * 1024);
    const reportUrl = new URL(
      `https://app.hypertask.ai${gatewayRequest.requestPath}`,
    );
    assert.equal(reportUrl.pathname, "/report");
    assert.equal(reportUrl.searchParams.get("tags"), `team:${TEAM_ID}`);
    assert.equal(reportUrl.searchParams.get("start_date"), TEST_PERIOD.startDate);
    assert.equal(reportUrl.searchParams.get("end_date"), TEST_PERIOD.endDate);
  } finally {
    restore();
  }
});

test("usage route rejects ownership changes before returning usage", async () => {
  const prisma = prismaFixture({ revokeOwnerAfterUsageSnapshot: true });
  const { route, restore } = loadRoute({
    authContext: {
      user: { id: 6, email: "owner@example.test" },
      agentId: null,
      management: { keyId: "3", permissions: { usage: ["read"] } },
    },
    funding: null,
    gatewayResponse: Response.json({ results: [] }),
    prisma,
  });

  try {
    const response = await route.GET(request());

    assert.equal(response.status, 404);
    assert.equal(prisma.aggregateCalls, 1);
  } finally {
    restore();
  }
});

test("full keys can read team-wide usage without a project id", async () => {
  const prisma = prismaFixture();
  const { route, restore } = loadRoute({
    authContext: {
      user: { id: 6, email: "owner@example.test" },
      agentId: null,
      management: {
        keyId: "2",
        permissions: {
          management: ["read", "write"],
          data: ["read", "write"],
          usage: ["read"],
        },
      },
    },
    funding: null,
    gatewayResponse: Response.json({ results: [] }),
    prisma,
  });

  try {
    const response = await route.GET(request(""));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.teamId, TEAM_ID);
    assert.equal(body.spendUsd, null);
  } finally {
    restore();
  }
});

test("legacy full keys can read team-wide usage at the auth boundary", async () => {
  const prisma = prismaFixture();
  const { route, restore } = loadRoute({
    funding: null,
    gatewayResponse: Response.json({ results: [] }),
    prisma,
    authBoundary: true,
  });

  try {
    const response = await route.GET(
      request(`?team_id=${TEAM_ID}`, "htmk_legacy-test"),
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.teamId, TEAM_ID);
    assert.equal(body.spendUsd, null);
    assert.deepEqual(body.usage, {
      inputTokens: 120,
      outputTokens: 30,
      requests: 3,
      totalTokens: 150,
    });
  } finally {
    restore();
  }
});

test("usage route stops before ownership and funding when rate limited", async () => {
  let fundingCalls = 0;
  let gatewayCalls = 0;
  const prisma = prismaFixture();
  const { route, restore } = loadRoute({
    authContext: {
      user: { id: 6, email: "owner@example.test" },
      agentId: null,
      management: { keyId: "1", permissions: { usage: ["read"] } },
    },
    funding: { apiKey: "must-not-be-read", source: "managed" },
    gatewayResponse: Response.json({ results: [] }),
    onFunding: () => {
      fundingCalls += 1;
    },
    onGateway: () => {
      gatewayCalls += 1;
    },
    prisma,
    rateLimitResponse: Response.json(
      { success: false, error: "rate limited" },
      { status: 429 },
    ),
  });

  try {
    const response = await route.GET(request());

    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), {
      success: false,
      error: "rate limited",
    });
    assert.equal(prisma.teamFindFirstArgs, undefined);
    assert.equal(prisma.aggregateCalls ?? 0, 0);
    assert.equal(fundingCalls, 0);
    assert.equal(gatewayCalls, 0);
  } finally {
    restore();
  }
});

test("usage route rejects a non-owner before loading spend", async () => {
  let fundingCalls = 0;
  let gatewayCalls = 0;
  const prisma = prismaFixture({ owner: false });
  const { route, restore } = loadRoute({
    authContext: {
      user: { id: 6, email: "member@example.test" },
      agentId: null,
      management: { keyId: "1", permissions: { usage: ["read"] } },
    },
    funding: {
      apiKey: "must-not-be-read",
      source: "managed",
    },
    gatewayResponse: Response.json({ results: [] }),
    prisma,
    onFunding: () => {
      fundingCalls += 1;
    },
    onGateway: () => {
      gatewayCalls += 1;
    },
  });

  try {
    const response = await route.GET(request());
    assert.equal(response.status, 404);
    assert.equal(fundingCalls, 0);
    assert.equal(prisma.aggregateCalls ?? 0, 0);
    assert.equal(gatewayCalls, 0);
    assert.equal(prisma.teamFindFirstArgs.where.id, TEAM_ID);
    assert.deepEqual(prisma.teamFindFirstArgs.where.googleAccount, {
      userId: 6,
    });
  } finally {
    restore();
  }
});

test("usage route rejects callers without a usage-key context", async () => {
  const { route, restore } = loadRoute({
    authContext: null,
    funding: undefined,
    gatewayResponse: Response.json({ results: [] }),
    prisma: prismaFixture(),
  });

  try {
    const response = await route.GET(request());
    assert.equal(response.status, 401);
  } finally {
    restore();
  }
});

test("usage route enforces management-key auth at the route boundary", async () => {
  for (const token of [
    "htmk_management-test",
    "htmk_invalid",
    regularBearerToken,
  ]) {
    let fundingCalls = 0;
    let gatewayCalls = 0;
    const prisma = prismaFixture();
    const { route, restore } = loadRoute({
      funding: { apiKey: "must-not-be-read", source: "managed" },
      gatewayResponse: Response.json({ results: [] }),
      onFunding: () => {
        fundingCalls += 1;
      },
      onGateway: () => {
        gatewayCalls += 1;
      },
      prisma,
      authBoundary: true,
    });

    try {
      const response = await route.GET(request(`?team_id=${TEAM_ID}`, token));
      assert.equal(response.status, 401);
      assert.equal(prisma.aggregateCalls ?? 0, 0);
      assert.equal(fundingCalls, 0);
      assert.equal(gatewayCalls, 0);
    } finally {
      restore();
    }
  }

  let fundingCalls = 0;
  let gatewayCalls = 0;
  const prisma = prismaFixture();
  const { route, restore } = loadRoute({
    funding: { apiKey: "must-not-be-read", source: "managed" },
    gatewayResponse: Response.json({ results: [] }),
    onFunding: () => {
      fundingCalls += 1;
    },
    onGateway: () => {
      gatewayCalls += 1;
    },
    prisma,
    authBoundary: true,
  });
  try {
    const response = await route.GET(
      request(`?team_id=${TEAM_ID}&project_id=1`, "htmk_usage-test"),
    );
    assert.equal(response.status, 401);
    assert.equal(prisma.aggregateCalls ?? 0, 0);
    assert.equal(fundingCalls, 0);
    assert.equal(gatewayCalls, 0);
  } finally {
    restore();
  }

  for (const invalidRequest of [
    request(`?team_id=${TEAM_ID}`, null),
    request(`?team_id=${TEAM_ID}`, "htmk_usage-test", "Basic"),
  ]) {
    let fundingCalls = 0;
    let gatewayCalls = 0;
    const prisma = prismaFixture();
    const { route, restore } = loadRoute({
      funding: { apiKey: "must-not-be-read", source: "managed" },
      gatewayResponse: Response.json({ results: [] }),
      onFunding: () => {
        fundingCalls += 1;
      },
      onGateway: () => {
        gatewayCalls += 1;
      },
      prisma,
      authBoundary: true,
    });

    try {
      const response = await route.GET(invalidRequest);
      assert.equal(response.status, 401);
      assert.equal(prisma.aggregateCalls ?? 0, 0);
      assert.equal(fundingCalls, 0);
      assert.equal(gatewayCalls, 0);
    } finally {
      restore();
    }
  }
});

test("data-capable management keys retain the project-scoped route", async () => {
  const prisma = prismaFixture({ expectedProjectAccess: { accessFor: 6 } });
  const { route, restore } = loadRoute({
    funding: null,
    gatewayResponse: Response.json({ results: [] }),
    prisma,
    getProjectWhere: (userId, agentId) => {
      assert.equal(userId, 6);
      assert.equal(agentId, null);
      return { accessFor: userId };
    },
    authBoundary: true,
  });

  try {
    const response = await route.GET(
      request("?project_id=1", "htmk_data-test"),
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      success: true,
      projectId: 1,
      groupBy: "model",
      totalTokens: 100,
      groups: [
        {
          key: "gpt-5",
          requests: 2,
          inputTokens: 80,
          outputTokens: 20,
          totalTokens: 100,
        },
      ],
    });
  } finally {
    restore();
  }
});

test("data-capable management keys cannot read another user's project", async () => {
  const prisma = prismaFixture({
    expectedProjectAccess: { accessFor: 6 },
    projectAccessible: false,
  });
  const { route, restore } = loadRoute({
    funding: null,
    gatewayResponse: Response.json({ results: [] }),
    prisma,
    getProjectWhere: (userId) => ({ accessFor: userId }),
    authBoundary: true,
  });

  try {
    const response = await route.GET(
      request("?project_id=1", "htmk_data-test"),
    );

    assert.equal(response.status, 404);
    assert.equal(prisma.aggregateCalls ?? 0, 0);
  } finally {
    restore();
  }
});

test("usage route binds ownership to the authenticated key identity", async () => {
  const userId = 12;
  const prisma = prismaFixture({
    expectedUserId: userId,
    ownedTeams: [{ id: OTHER_TEAM_ID }],
    userRecord: {
      displayName: "Second owner",
      email: "second-owner@example.test",
      id: userId,
    },
  });
  const { route, restore } = loadRoute({
    authContext: {
      user: { id: userId, email: "second-owner@example.test" },
      agentId: null,
      management: { keyId: "2", permissions: { usage: ["read"] } },
    },
    funding: null,
    gatewayResponse: Response.json({ results: [] }),
    prisma,
  });

  try {
    const response = await route.GET(request(`?team_id=${OTHER_TEAM_ID}`));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.teamId, OTHER_TEAM_ID);
    assert.deepEqual(prisma.teamFindFirstArgs.where.googleAccount, {
      userId,
    });
  } finally {
    restore();
  }
});

test("usage route resolves a single owned team when team_id is omitted", async () => {
  const prisma = prismaFixture();
  const { route, restore } = loadRoute({
    authContext: {
      user: { id: 6, email: "owner@example.test" },
      agentId: null,
      management: { keyId: "1", permissions: { usage: ["read"] } },
    },
    funding: null,
    gatewayResponse: Response.json({ results: [] }),
    prisma,
  });

  try {
    const response = await route.GET(request(""));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.teamId, TEAM_ID);
    assert.equal(body.spendUsd, null);
    assert.equal(prisma.teamFindManyArgs.take, 2);
  } finally {
    restore();
  }
});

test("usage route requires team_id when the owner has multiple teams", async () => {
  const prisma = prismaFixture({
    ownedTeams: [{ id: TEAM_ID }, { id: OTHER_TEAM_ID }],
  });
  const { route, restore } = loadRoute({
    authContext: {
      user: { id: 6, email: "owner@example.test" },
      agentId: null,
      management: { keyId: "1", permissions: { usage: ["read"] } },
    },
    funding: null,
    gatewayResponse: Response.json({ results: [] }),
    prisma,
  });

  try {
    const response = await route.GET(request(""));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.field, "team_id");
    assert.equal(prisma.teamFindFirstArgs, undefined);
    assert.equal(prisma.aggregateCalls ?? 0, 0);
  } finally {
    restore();
  }
});

test("usage route rejects an owner with no teams before loading spend", async () => {
  let fundingCalls = 0;
  let gatewayCalls = 0;
  const prisma = prismaFixture({ ownedTeams: [] });
  const { route, restore } = loadRoute({
    authContext: {
      user: { id: 6, email: "owner@example.test" },
      agentId: null,
      management: { keyId: "1", permissions: { usage: ["read"] } },
    },
    funding: { apiKey: "must-not-be-read", source: "managed" },
    gatewayResponse: Response.json({ results: [] }),
    onFunding: () => {
      fundingCalls += 1;
    },
    onGateway: () => {
      gatewayCalls += 1;
    },
    prisma,
  });

  try {
    const response = await route.GET(request(""));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error, "team_id is required");
    assert.equal(body.field, "team_id");
    assert.equal(fundingCalls, 0);
    assert.equal(gatewayCalls, 0);
    assert.equal(prisma.aggregateCalls ?? 0, 0);
  } finally {
    restore();
  }
});

test("usage route validates team_id before querying Prisma", async () => {
  const prisma = prismaFixture();
  const { route, restore } = loadRoute({
    authContext: {
      user: { id: 6, email: "owner@example.test" },
      agentId: null,
      management: { keyId: "1", permissions: { usage: ["read"] } },
    },
    funding: null,
    gatewayResponse: Response.json({ results: [] }),
    prisma,
  });

  try {
    const response = await route.GET(request("?team_id=not-a-uuid"));
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.code, "invalid_field");
    assert.equal(body.field, "team_id");
    assert.equal(prisma.teamFindFirstArgs, undefined);
  } finally {
    restore();
  }
});

test("usage route returns 404 for an unknown team", async () => {
  let fundingCalls = 0;
  const prisma = prismaFixture({ teamExists: false });
  const { route, restore } = loadRoute({
    authContext: {
      user: { id: 6, email: "owner@example.test" },
      agentId: null,
      management: { keyId: "1", permissions: { usage: ["read"] } },
    },
    funding: { apiKey: "must-not-be-read", source: "managed" },
    gatewayResponse: Response.json({ results: [] }),
    onFunding: () => {
      fundingCalls += 1;
    },
    prisma,
  });

  try {
    const response = await route.GET(request());
    assert.equal(response.status, 404);
    assert.equal(fundingCalls, 0);
  } finally {
    restore();
  }
});

test("usage route fails closed when team ownership lookup fails", async () => {
  for (const failure of [
    { teamFindManyError: true, search: "" },
    { teamFindFirstError: true, search: `?team_id=${TEAM_ID}` },
  ]) {
    let fundingCalls = 0;
    let gatewayCalls = 0;
    const { route, restore } = loadRoute({
      authContext: {
        user: { id: 6, email: "owner@example.test" },
        agentId: null,
        management: { keyId: "1", permissions: { usage: ["read"] } },
      },
      funding: { apiKey: "must-not-be-read", source: "managed" },
      gatewayResponse: Response.json({ results: [] }),
      onFunding: () => {
        fundingCalls += 1;
      },
      onGateway: () => {
        gatewayCalls += 1;
      },
      prisma: prismaFixture(failure),
    });

    try {
      const response = await route.GET(request(failure.search));
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        success: false,
        error: "Could not load AI usage",
      });
      assert.equal(fundingCalls, 0);
      assert.equal(gatewayCalls, 0);
    } finally {
      restore();
    }
  }
});

test("usage route fails closed when token totals are unavailable", async () => {
  let fundingCalls = 0;
  const { route, restore } = loadRoute({
    aggregateGatewayUsage: () => ({ totalCost: 0.42 }),
    authContext: {
      user: { id: 6, email: "owner@example.test" },
      agentId: null,
      management: { keyId: "1", permissions: { usage: ["read"] } },
    },
    funding: { apiKey: "must-not-be-read", source: "managed" },
    gatewayResponse: Response.json({ results: [] }),
    onFunding: () => {
      fundingCalls += 1;
    },
    prisma: prismaFixture({ aggregateError: true }),
  });

  try {
    const response = await route.GET(request());
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.deepEqual(body, {
      success: false,
      error: "Could not load AI usage",
    });
    assert.equal(fundingCalls, 0);
  } finally {
    restore();
  }
});

test("usage route returns 502 for gateway HTTP and payload failures", async () => {
  const failures = [
    {
      gatewayResponse: new Response("gateway unavailable", { status: 503 }),
    },
    {
      aggregateGatewayUsage: () => {
        throw new Error("malformed gateway payload");
      },
      gatewayResponse: Response.json({ results: [null] }),
    },
    {
      onFunding: () => {
        throw new Error("funding lookup unavailable");
      },
      gatewayResponse: Response.json({ results: [] }),
    },
    {
      funding: { source: "managed" },
      gatewayResponse: Response.json({ results: [] }),
      expectGatewayCalls: 0,
    },
  ];

  for (const failure of failures) {
    let gatewayCalls = 0;
    const { route, restore } = loadRoute({
      funding: { apiKey: "vck_test", source: "managed" },
      ...failure,
      authContext: {
        user: { id: 6, email: "owner@example.test" },
        agentId: null,
        management: { keyId: "1", permissions: { usage: ["read"] } },
      },
      prisma: prismaFixture(),
      onGateway: () => {
        gatewayCalls += 1;
      },
    });

    try {
      const response = await route.GET(request());
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        success: false,
        error: "Could not load AI usage",
      });
      if (failure.expectGatewayCalls !== undefined) {
        assert.equal(gatewayCalls, failure.expectGatewayCalls);
      }
    } finally {
      restore();
    }
  }
});
