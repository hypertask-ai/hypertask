const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const routePath = "src/app/api/mcp/admin/keys/route.ts";
const stubbedPaths = [
  routePath,
  "src/lib/mcp/auth.ts",
  "src/lib/auth/betterAuth.ts",
  "src/lib/flags.ts",
  "src/lib/mcp/managementKeyTeamScope.ts",
  "src/lib/prisma.ts",
];
const originalModules = new Map(
  stubbedPaths.map((relativePath) => {
    const filename = path.join(root, relativePath);
    return [filename, require.cache[filename]];
  }),
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

let context = {
  user: { id: 6, email: "owner@example.test" },
  agentId: null,
};
let rateLimitResponse = null;
let featureEnabled = true;
const calls = [];
const linkedKeys = [];
const listQueries = [];
const serial = { concurrency: false };

stubModule("src/lib/mcp/auth.ts", {
  checkMcpRateLimit: async () => rateLimitResponse,
  MANAGEMENT_KEY_PREFIX: "htmk_",
  // The sibling integration suite drives the real validator while this suite
  // isolates provider and route behavior.
  validateManagementOrSessionAuth: async () => context,
  createUnauthorizedResponse: () => Response.json({ success: false }, { status: 401 }),
});
stubModule("src/lib/auth/betterAuth.ts", {
  auth: {
    api: {
      createApiKey: async ({ body }) => {
        calls.push(body);
        if (body.name === "Provider failure") {
          throw new Error("provider secret");
        }
        return {
          id: "42",
          key: `${body.prefix ?? "htmk_"}created_once`,
          name: body.name,
          start: body.prefix ?? "htmk_",
          permissions: body.permissions,
          enabled: true,
          lastRequest: null,
          expiresAt: null,
          createdAt: new Date("2026-08-21T00:00:00.000Z"),
        };
      },
    },
  },
});
stubModule("src/lib/flags.ts", {
  HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG:
    "htpr-6542-team-scoped-management-keys",
  isFeatureEnabled: async () => featureEnabled,
});
stubModule("src/lib/mcp/managementKeyTeamScope.ts", {
  TEAM_MANAGEMENT_KEY_PREFIX: "httk_",
  getManagementKeyTeam: async (_userId, teamId) => ({
    id: teamId,
    title: "Alpha",
    isOwner: true,
    accessBinding: "owner:account-1",
  }),
  listManagementKeyTeams: async () => [],
});
stubModule("src/lib/prisma.ts", {
  default: {
    betterAuthApiKey: {
      findMany: async (args) => {
        listQueries.push(args);
        return [];
      },
      updateMany: async (args) => {
        linkedKeys.push(args);
        return { count: 1 };
      },
    },
  },
});

const jiti = require("jiti")(
  path.join(root, "tests/management-key-route.test.cjs"),
  {
    alias: { "@": path.join(root, "src") },
    cache: false,
    interopDefault: true,
  },
);
const { GET, POST } = jiti(path.join(root, routePath));

function request(body) {
  return new NextRequest("https://app.hypertask.ai/api/mcp/admin/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rawRequest(body) {
  return new NextRequest("https://app.hypertask.ai/api/mcp/admin/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

test.beforeEach(() => {
  featureEnabled = true;
  linkedKeys.length = 0;
  listQueries.length = 0;
});

test.after(() => {
  for (const [filename, original] of originalModules) {
    if (original) {
      require.cache[filename] = original;
    } else {
      delete require.cache[filename];
    }
  }
});

test("key inventory hides team keys while rollout is off", serial, async () => {
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
  };
  featureEnabled = false;

  const response = await GET(
    new NextRequest("https://app.hypertask.ai/api/mcp/admin/keys"),
  );

  assert.equal(response.status, 200);
  assert.equal(listQueries[0].where.prefix, "htmk_");
  assert.deepEqual((await response.json()).keys, []);
});

test("key inventory includes team keys while rollout is on", serial, async () => {
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
  };

  const response = await GET(
    new NextRequest("https://app.hypertask.ai/api/mcp/admin/keys"),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(listQueries[0].where.prefix, {
    in: ["htmk_", "httk_"],
  });
});

test("the key route creates a usage-only key", serial, async () => {
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
  };
  calls.length = 0;

  const response = await POST(
    request({ name: "Usage automation", scope: "usage", expiresInDays: 1 }),
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(calls[0].userId, "6");
  assert.equal(calls[0].name, "Usage automation");
  assert.deepEqual(calls[0].permissions, { usage: ["read"] });
  assert.equal(calls[0].expiresIn, 24 * 60 * 60);
  assert.deepEqual(body.apiKey.permissions, { usage: ["read"] });
  assert.equal(body.key, "htmk_created_once");
});

test("the key route creates and binds a team-scoped key", serial, async () => {
  const teamId = "11111111-1111-4111-8111-111111111111";
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
  };
  calls.length = 0;

  const response = await POST(
    request({ name: "Alpha automation", scope: "management", teamId }),
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(calls[0].prefix, "httk_");
  assert.equal(body.key, "httk_created_once");
  assert.equal(body.apiKey.teamScoped, true);
  assert.deepEqual(body.apiKey.team, { id: teamId, title: "Alpha" });
  assert.deepEqual(linkedKeys, [
    {
      where: {
        id: 42,
        userId: 6,
        prefix: "httk_",
        teamId: null,
      },
      data: { teamId, teamAccessBinding: "owner:account-1" },
    },
  ]);
});

test("the key route rejects team scope while rollout is off", serial, async () => {
  featureEnabled = false;
  calls.length = 0;

  const response = await POST(
    request({
      name: "Not yet available",
      teamId: "11111111-1111-4111-8111-111111111111",
    }),
  );

  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /not enabled/i);
  assert.deepEqual(calls, []);
  assert.deepEqual(linkedKeys, []);
});

test("the key route rejects full access for a team", serial, async () => {
  calls.length = 0;

  const response = await POST(
    request({
      name: "Too broad",
      scope: "full",
      teamId: "11111111-1111-4111-8111-111111111111",
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.reason, "unsupported_scope");
  assert.deepEqual(calls, []);
  assert.deepEqual(linkedKeys, []);
});

test("the key route stops before creating a key when rate limited", serial, async () => {
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
  };
  rateLimitResponse = Response.json(
    { success: false, error: "rate limited" },
    { status: 429 },
  );
  calls.length = 0;

  try {
    const response = await POST(request({ name: "Rate limited", scope: "usage" }));

    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), {
      success: false,
      error: "rate limited",
    });
    assert.deepEqual(calls, []);
  } finally {
    rateLimitResponse = null;
  }
});

test("the key route sanitizes provider failures", serial, async () => {
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
  };
  calls.length = 0;

  const response = await POST(
    request({ name: "Provider failure", scope: "usage" }),
  );
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.error, "Failed to create management key");
  assert.equal(body.details, undefined);
  assert.doesNotMatch(JSON.stringify(body), /provider secret/);
});

test("a management-only key cannot mint a usage key", serial, async () => {
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
    management: {
      keyId: "7",
      permissions: { management: ["read", "write"] },
    },
  };
  calls.length = 0;

  for (const scope of ["usage", "full"]) {
    const response = await POST(request({ name: "Too broad", scope }));
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.reason, "insufficient_scope");
  }
  assert.deepEqual(calls, []);
});

test("a legacy full key can mint usage and full successor keys", serial, async () => {
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
    management: {
      keyId: "8",
      permissions: {
        management: ["read", "write"],
        data: ["read", "write"],
      },
    },
  };
  calls.length = 0;

  for (const scope of ["usage", "full"]) {
    const response = await POST(request({ name: `Legacy ${scope}`, scope }));
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.success, true);
  }
  assert.deepEqual(calls.map(({ name, permissions }) => ({ name, permissions })), [
    { name: "Legacy usage", permissions: { usage: ["read"] } },
    {
      name: "Legacy full",
      permissions: {
        management: ["read", "write"],
        data: ["read", "write"],
        usage: ["read"],
      },
    },
  ]);
});

test("an explicit usage restriction blocks full successor scopes", serial, async () => {
  for (const usage of [[], ["write"]]) {
    context = {
      user: { id: 6, email: "owner@example.test" },
      agentId: null,
      management: {
        keyId: "9",
        permissions: {
          management: ["read", "write"],
          data: ["read", "write"],
          usage,
        },
      },
    };
    calls.length = 0;

    for (const scope of ["usage", "full"]) {
      const response = await POST(request({ name: "Restricted", scope }));
      const body = await response.json();

      assert.equal(response.status, 403);
      assert.equal(body.reason, "insufficient_scope");
    }
    assert.deepEqual(calls, []);
  }
});

test("a partial data key cannot mint a full successor scope", serial, async () => {
  for (const permissions of [
    {
      management: ["read"],
      data: ["read", "write"],
      usage: ["read"],
    },
    {
      data: ["read", "write"],
      usage: ["read"],
    },
  ]) {
    context = {
      user: { id: 6, email: "owner@example.test" },
      agentId: null,
      management: {
        keyId: "10",
        permissions,
      },
    };
    calls.length = 0;

    const response = await POST(request({ name: "Partial full", scope: "full" }));
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.reason, "insufficient_scope");
    assert.deepEqual(calls, []);
  }
});

test("the key route rejects an unknown scope", serial, async () => {
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
  };
  calls.length = 0;

  const response = await POST(request({ name: "Invalid", scope: "unknown" }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "Invalid request");
  assert.deepEqual(calls, []);
});

test("the key route creates management and full scopes", serial, async () => {
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
  };

  for (const scope of ["management", "full"]) {
    calls.length = 0;
    const expiresInDays = scope === "management" ? 365 : undefined;
    const response = await POST(
      request({
        name: `${scope} automation`,
        scope,
        ...(expiresInDays ? { expiresInDays } : {}),
      }),
    );
    const body = await response.json();

    assert.equal(response.status, 201);
    const expected =
      scope === "full"
        ? {
            management: ["read", "write"],
            data: ["read", "write"],
            usage: ["read"],
          }
        : { management: ["read", "write"] };
    assert.equal(calls[0].userId, "6");
    assert.equal(calls[0].name, `${scope} automation`);
    assert.deepEqual(calls[0].permissions, expected);
    assert.deepEqual(body.apiKey.permissions, expected);
    if (expiresInDays) assert.equal(calls[0].expiresIn, 365 * 24 * 60 * 60);
    else assert.equal(calls[0].expiresIn, undefined);
  }
});

test("the key route rejects unauthenticated and malformed requests", serial, async () => {
  context = null;
  calls.length = 0;
  const unauthenticated = await POST(request({ name: "No auth" }));
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(calls, []);

  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
  };
  for (const [body, expectedError] of [
    [null, "Invalid request"],
    ["text", "Invalid request"],
    [[], "Invalid request"],
    [{ name: "" }, "Invalid request"],
    [{ name: "x".repeat(33) }, "Invalid request"],
    [{ name: "Bad scope", scope: 123 }, "Invalid request"],
    [{ name: "Bad expiry", expiresInDays: 0 }, "Invalid request"],
    [{ name: "Bad expiry", expiresInDays: -1 }, "Invalid request"],
    [{ name: "Bad expiry", expiresInDays: 1.5 }, "Invalid request"],
    [{ name: "Bad expiry", expiresInDays: 366 }, "Invalid request"],
    [{}, "Invalid request"],
    [{ name: 123 }, "Invalid request"],
    [{ name: "Bad expiry", expiresInDays: null }, "Invalid request"],
  ]) {
    const response = await POST(request(body));
    const responseBody = await response.json();
    assert.equal(response.status, 400);
    assert.equal(responseBody.error, expectedError);
    assert.deepEqual(calls, []);
  }
  const malformed = await POST(rawRequest("not-json"));
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, "Invalid JSON request body");
  assert.deepEqual(calls, []);
});
