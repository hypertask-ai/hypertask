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
  "src/lib/prisma.ts",
  "src/lib/flags.ts",
  "src/lib/flags/keys.ts",
  "src/lib/mcp/managementKeyTeamScope.ts",
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
let teamFlagEnabled = true;
const calls = [];
const linkedKeys = [];
const disabledKeys = [];
let linkBehavior = "success";
let listArgs;
const requiredActions = [];
const serial = { concurrency: false };

stubModule("src/lib/mcp/auth.ts", {
  checkMcpRateLimit: async () => rateLimitResponse,
  // The sibling integration suite drives the real validator. This unit stub
  // records the route's required action so the assertions below catch a
  // silently weakened POST authorization check.
  validateManagementOrSessionAuth: async (_request, requiredAction) => {
    requiredActions.push(requiredAction);
    return context;
  },
  createUnauthorizedResponse: () => Response.json({ success: false }, { status: 401 }),
  MANAGEMENT_KEY_PREFIX: "htmk_",
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
          id: body.name === "Invalid provider id" ? "not-an-id" : "42",
          key: `${body.prefix || "htmk_"}created_once`,
          name: body.name,
          start: body.prefix || "htmk_",
          permissions: body.permissions,
          enabled: true,
          lastRequest: null,
          expiresAt: null,
          createdAt: new Date("2026-08-21T00:00:00.000Z"),
        };
      },
      updateApiKey: async ({ body }) => {
        disabledKeys.push(body);
        return { success: true };
      },
    },
  },
});
stubModule("src/lib/prisma.ts", {
  default: {
    betterAuthApiKey: {
      findMany: async (args) => {
        listArgs = args;
        return [
          {
            id: 42,
            name: "Account key",
            start: "htmk_",
            prefix: "htmk_",
            permissions: { management: ["read"] },
            enabled: true,
            lastRequest: null,
            expiresAt: null,
            createdAt: new Date("2026-08-21T00:00:00.000Z"),
            team: null,
          },
          {
            id: 43,
            name: "Team key",
            start: "httk_",
            prefix: "httk_",
            permissions: { management: ["read"] },
            enabled: true,
            lastRequest: null,
            expiresAt: null,
            createdAt: new Date("2026-08-21T00:00:00.000Z"),
            team: { id: "team-a", title: "Team A" },
          },
        ];
      },
      updateMany: async (args) => {
        linkedKeys.push(args);
        if (linkBehavior === "throw") throw new Error("link failed");
        if (linkBehavior === "zero") return { count: 0 };
        return { count: 1 };
      },
    },
  },
});
stubModule("src/lib/flags.ts", {
  isFeatureEnabled: async () => teamFlagEnabled,
});
stubModule("src/lib/flags/keys.ts", {
  TEAM_SCOPED_MANAGEMENT_KEYS_FLAG: "htpr-4540-team-scoped-management-keys",
});
stubModule("src/lib/mcp/managementKeyTeamScope.ts", {
  TEAM_MANAGEMENT_KEY_PREFIX: "httk_",
  getManagementKeyTeam: async (_userId, teamId) => ({
    id: teamId,
    title: teamId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" ? "Team A" : "Team B",
    isOwner: teamId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    accessBinding:
      teamId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        ? "owner:account-a"
        : "member:membership-b",
  }),
  listManagementKeyTeams: async () => [],
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

function getRequest() {
  return new NextRequest("https://app.hypertask.ai/api/mcp/admin/keys");
}

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

test.after(() => {
  for (const [filename, original] of originalModules) {
    if (original) {
      require.cache[filename] = original;
    } else {
      delete require.cache[filename];
    }
  }
});

test("the key route creates a usage-only key", serial, async () => {
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
  };
  calls.length = 0;
  requiredActions.length = 0;

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
  assert.deepEqual(requiredActions, ["write"]);
});

test("listing keeps team keys revokable but hides team details while the flag is off", serial, async () => {
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
  };
  listArgs = undefined;
  requiredActions.length = 0;
  teamFlagEnabled = false;

  try {
    const response = await GET(getRequest());
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(listArgs.where.prefix, { in: ["htmk_", "httk_"] });
    assert.deepEqual(body.teams, []);
    assert.equal(body.keys[0].team, null);
    assert.equal(body.keys[1].team, null);
    assert.equal(body.keys[0].teamScoped, false);
    assert.equal(body.keys[1].teamScoped, true);
    assert.deepEqual(requiredActions, ["read"]);
  } finally {
    teamFlagEnabled = true;
  }
});

test("the key route creates a fail-closed team key and links its team", serial, async () => {
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
  };
  calls.length = 0;
  linkedKeys.length = 0;
  disabledKeys.length = 0;
  const teamId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  const response = await POST(
    request({ name: "Team automation", scope: "management", teamId }),
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(calls[0].prefix, "httk_");
  assert.deepEqual(linkedKeys, [
    {
      where: {
        id: 42,
        userId: 6,
        prefix: "httk_",
        teamId: null,
      },
      data: { teamId, teamAccessBinding: "owner:account-a" },
    },
  ]);
  assert.equal(body.key, "httk_created_once");
  assert.equal(body.apiKey.teamScoped, true);
  assert.deepEqual(body.apiKey.team, { id: teamId, title: "Team A" });
  assert.deepEqual(disabledKeys, []);
});

test("a team key is disabled if its team link is not written", serial, async () => {
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
  };
  calls.length = 0;
  linkedKeys.length = 0;
  disabledKeys.length = 0;
  const teamId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  try {
    for (const behavior of ["zero", "throw"]) {
      linkBehavior = behavior;
      const disabledBefore = disabledKeys.length;
      const response = await POST(
        request({ name: `Broken link ${behavior}`, scope: "management", teamId }),
      );
      assert.equal(response.status, 500);
      assert.equal(disabledKeys.length, disabledBefore + 1);
    }
  } finally {
    linkBehavior = "success";
  }

  assert.equal(calls.length, 2);
  assert.deepEqual(disabledKeys, [
    { keyId: "42", userId: "6", enabled: false },
    { keyId: "42", userId: "6", enabled: false },
  ]);
});

test("a team key with an invalid provider id is disabled", serial, async () => {
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
  };
  calls.length = 0;
  linkedKeys.length = 0;
  disabledKeys.length = 0;

  const response = await POST(
    request({
      name: "Invalid provider id",
      scope: "management",
      teamId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }),
  );

  assert.equal(response.status, 500);
  assert.deepEqual(linkedKeys, []);
  assert.deepEqual(disabledKeys, [
    { keyId: "not-an-id", userId: "6", enabled: false },
  ]);
});

test("the server blocks team-key creation while the feature flag is off", serial, async () => {
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
  };
  calls.length = 0;
  teamFlagEnabled = false;

  try {
    const response = await POST(
      request({
        name: "Flagged off",
        scope: "management",
        teamId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    );
    assert.equal(response.status, 403);
    assert.deepEqual(calls, []);
  } finally {
    teamFlagEnabled = true;
  }
});

test("team keys cannot widen themselves or request full data access", serial, async () => {
  const teamId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const otherTeamId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
    management: {
      keyId: "7",
      teamId,
      permissions: { management: ["read", "write"] },
    },
  };
  calls.length = 0;

  const crossTeam = await POST(
    request({ name: "Other team", scope: "management", teamId: otherTeamId }),
  );
  assert.equal(crossTeam.status, 403);

  const full = await POST(request({ name: "Too broad", scope: "full" }));
  assert.equal(full.status, 400);
  assert.equal((await full.json()).reason, "unsupported_scope");
  assert.deepEqual(calls, []);
});

test("team usage keys require ownership of the selected team", serial, async () => {
  context = {
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
  };
  calls.length = 0;

  const response = await POST(
    request({
      name: "Member usage",
      scope: "usage",
      teamId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(calls, []);
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
