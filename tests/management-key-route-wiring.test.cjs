// Unit-style route/auth wiring coverage. Better Auth and Prisma are deliberately
// stubbed here; provider-specific behavior belongs in the adapter test suite.
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const hashApiKeyForProvider = (value) => `hashed:${value}`;
const paths = [
  "src/app/api/mcp/admin/keys/route.ts",
  "src/lib/mcp/auth.ts",
  "src/lib/prisma.ts",
  "src/lib/auth/betterAuth.ts",
  "src/lib/redis.ts",
  "src/lib/apiKeys.ts",
  "src/lib/auth/getSessionUser.ts",
  "src/utils/controllers/logs/createLog.ts",
];
const originalCache = new Map(Object.entries(require.cache));

function clear(relativePath) {
  delete require.cache[path.join(root, relativePath)];
}

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

paths.forEach(clear);

let session = { userId: 6 };
const creates = [];
const serial = { concurrency: false };
const keyFixtures = new Map([
  [
    "htmk_management",
    {
      id: 7,
      referenceId: "6",
      enabled: true,
      expiresAt: null,
      permissions: { management: ["read", "write"] },
    },
  ],
  [
    "htmk_usage",
    {
      id: 8,
      referenceId: "6",
      enabled: true,
      expiresAt: null,
      permissions: { usage: ["read"] },
    },
  ],
  [
    "htmk_foreign",
    {
      id: 17,
      referenceId: "99",
      enabled: true,
      expiresAt: null,
      permissions: { management: ["read", "write"] },
    },
  ],
  [
    "htmk_data",
    {
      id: 9,
      referenceId: "6",
      enabled: true,
      expiresAt: null,
      permissions: { data: ["read"] },
    },
  ],
  [
    "htmk_invalid-permissions",
    {
      id: 12,
      referenceId: "6",
      enabled: true,
      expiresAt: null,
      permissions: "invalid",
    },
  ],
  [
    "htmk_null-permissions",
    {
      id: 13,
      referenceId: "6",
      enabled: true,
      expiresAt: null,
      permissions: null,
    },
  ],
  [
    "htmk_invalid-actions",
    {
      id: 14,
      referenceId: "6",
      enabled: true,
      expiresAt: null,
      permissions: { management: ["read", 1] },
    },
  ],
  [
    "htmk_disabled",
    {
      id: 15,
      referenceId: "6",
      enabled: false,
      expiresAt: null,
      permissions: { usage: ["read"] },
    },
  ],
  [
    "htmk_expired",
    {
      id: 16,
      referenceId: "6",
      enabled: true,
      expiresAt: new Date(Date.now() - 1),
      permissions: { usage: ["read"] },
    },
  ],
].map(([token, fixture]) => [hashApiKeyForProvider(token), fixture]));

stubModule("src/lib/prisma.ts", {
  default: {
    user: {
      findUnique: async ({ where }) =>
        where.id === 6
          ? {
              id: 6,
              email: "owner@example.test",
              displayName: "Owner",
            }
          : where.id === 99
            ? {
                id: 99,
                email: "foreign@example.test",
                displayName: "Foreign",
              }
            : null,
    },
  },
});
stubModule("src/lib/auth/betterAuth.ts", {
  auth: {
    api: {
      verifyApiKey: async ({ body }) => {
        assert.equal(typeof body.key, "string");
        assert.match(body.key, /^htmk_/);
        const key = keyFixtures.get(hashApiKeyForProvider(body.key));
        const usable =
          key?.enabled &&
          (!key.expiresAt || new Date(key.expiresAt).getTime() > Date.now());
        return usable ? { valid: true, key } : { valid: false, key: null };
      },
      createApiKey: async ({ body }) => {
        assert.equal(typeof body.name, "string");
        assert.equal(typeof body.userId, "string");
        assert.match(body.userId, /^\d+$/);
        assert.ok(body.permissions);
        if (body.expiresIn !== undefined) {
          assert.ok(Number.isInteger(body.expiresIn));
          assert.ok(body.expiresIn >= 24 * 60 * 60);
        }
        creates.push(body);
        if (body.name === "Provider failure") {
          throw new Error("provider unavailable");
        }
        return {
          id: "42",
          key: "htmk_created_once",
          name: body.name,
          start: "htmk_",
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
stubModule("src/lib/redis.ts", {
  getRedis: async () => ({ incr: async () => 1, expire: async () => 1 }),
});
stubModule("src/lib/apiKeys.ts", { hashApiKey: hashApiKeyForProvider });
stubModule("src/lib/auth/getSessionUser.ts", {
  getSessionUser: async () => session,
});
stubModule("src/utils/controllers/logs/createLog.ts", { default: async () => {} });

const jiti = require("jiti")(
  path.join(root, "tests/management-key-route-wiring.test.cjs"),
  {
    alias: { "@": path.join(root, "src") },
    cache: false,
    interopDefault: true,
  },
);
const route = jiti(path.join(root, "src/app/api/mcp/admin/keys/route.ts"));

function request(body, token) {
  return new NextRequest("https://app.hypertask.ai/api/mcp/admin/keys", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function rawRequest(body, token) {
  return new NextRequest("https://app.hypertask.ai/api/mcp/admin/keys", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
}

test.after(() => {
  for (const filename of Object.keys(require.cache)) {
    if (!originalCache.has(filename)) delete require.cache[filename];
  }
  for (const [filename, original] of originalCache) {
    require.cache[filename] = original;
  }
});

test("the session-authenticated owner path permits creating a usage key", serial, async () => {
  session = { userId: 6 };
  creates.length = 0;

  const response = await route.POST(
    request({ name: "Usage integration", scope: "usage" }),
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(creates[0].permissions, { usage: ["read"] });
  assert.deepEqual(body.apiKey.permissions, { usage: ["read"] });
});

test("a management key keeps its Better Auth owner as the created-key owner", serial, async () => {
  session = null;
  creates.length = 0;

  const response = await route.POST(
    request({ name: "Foreign owner", scope: "management" }, "htmk_foreign"),
  );

  assert.equal(response.status, 201);
  assert.equal(creates[0].userId, "99");
});

test("the management-key permission gate blocks a management-only key", serial, async () => {
  session = null;
  creates.length = 0;

  const response = await route.POST(
    request({ name: "Too broad", scope: "usage" }, "htmk_management"),
  );
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.reason, "insufficient_scope");
  assert.deepEqual(creates, []);
});

test("the management-key gate rejects a usage key from key administration", serial, async () => {
  session = null;
  creates.length = 0;

  const response = await route.POST(
    request({ name: "Cannot administer", scope: "management" }, "htmk_usage"),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(creates, []);
});

test("the management-key route rejects an unknown bearer key", serial, async () => {
  session = null;
  creates.length = 0;

  const response = await route.POST(
    request({ name: "Unknown credential", scope: "usage" }, "htmk_unknown"),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(creates, []);
});

test("the management-key route rejects missing and non-management bearers", serial, async () => {
  session = null;
  creates.length = 0;

  for (const token of [
    undefined,
    "",
    "htmk_data",
    "htmk_disabled",
    "htmk_expired",
  ]) {
    const response = await route.POST(
      request({ name: "Rejected credential", scope: "usage" }, token),
    );
    assert.equal(response.status, 401);
  }
  const jwtResponse = await route.POST(
    request({ name: "Rejected credential", scope: "usage" }, "jwt_not_management"),
  );
  assert.equal(jwtResponse.status, 401);
  assert.deepEqual(creates, []);
});

test("the management-key route validates request bodies and sanitizes provider errors", serial, async () => {
  session = { userId: 6 };
  creates.length = 0;

  for (const body of [
    { name: "", scope: "usage" },
    { name: "Bad scope", scope: "unknown" },
    { name: "Bad expiry", scope: "usage", expiresInDays: 0 },
  ]) {
    const response = await route.POST(request(body));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "Invalid request");
  }
  const malformedJson = await route.POST(rawRequest("not-json"));
  assert.equal(malformedJson.status, 400);
  assert.equal((await malformedJson.json()).error, "Invalid JSON request body");

  const providerFailure = await route.POST(
    request({ name: "Provider failure", scope: "usage" }),
  );
  assert.equal(providerFailure.status, 500);
  assert.equal(
    (await providerFailure.json()).error,
    "Failed to create management key",
  );
  assert.deepEqual(creates, [{
    name: "Provider failure",
    userId: "6",
    permissions: { usage: ["read"] },
  }]);
});

test("the management-key route rejects malformed permission metadata", serial, async () => {
  session = null;
  creates.length = 0;

  for (const token of [
    "htmk_invalid-permissions",
    "htmk_null-permissions",
    "htmk_invalid-actions",
  ]) {
    const response = await route.POST(
      request({ name: "Rejected credential", scope: "usage" }, token),
    );
    assert.equal(response.status, 401);
  }
  assert.deepEqual(creates, []);
});
