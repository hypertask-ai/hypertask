const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const regularBearerToken = ["regular", "bearer", "fixture"].join("-");

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

const authPath = "src/lib/mcp/auth.ts";
const stubbedPaths = [
  authPath,
  "src/lib/prisma.ts",
  "src/lib/auth/betterAuth.ts",
  "src/lib/redis.ts",
  "src/lib/apiKeys.ts",
  "src/lib/auth/getSessionUser.ts",
  "src/utils/controllers/logs/createLog.ts",
];
const originalModules = new Map(
  stubbedPaths.map((relativePath) => {
    const filename = path.join(root, relativePath);
    return [filename, require.cache[filename]];
  }),
);

const permissionsByToken = new Map();
const rateLimitKeys = [];
const rejectedTokens = new Set();
const DEFAULT_USER = {
  id: 6,
  email: "owner@example.test",
  displayName: "Owner",
};
let configuredUser = DEFAULT_USER;
stubModule("src/lib/prisma.ts", {
  default: {
    user: {
      findUnique: async ({ where }) =>
        configuredUser?.id === where.id ? configuredUser : null,
    },
  },
});
stubModule("src/lib/auth/betterAuth.ts", {
  auth: {
    api: {
      verifyApiKey: async ({ body }) => {
        if (body.key === "htmk_verifier-error") {
          throw new Error("verifier unavailable");
        }
        if (rejectedTokens.has(body.key)) {
          return { valid: false, key: null };
        }
        const tokenPermissions = permissionsByToken.get(body.key);
        return tokenPermissions
          ? {
              valid: true,
              key: {
                id: 1,
                referenceId:
                  body.key === "htmk_missing-user" ? "7" : "6",
                permissions: tokenPermissions,
              },
            }
          : { valid: false, key: null };
      },
    },
  },
});
stubModule("src/lib/redis.ts", {
  getRedis: async () => ({
    incr: async (key) => {
      rateLimitKeys.push(key);
      return 1;
    },
    expire: async () => 1,
  }),
});
stubModule("src/lib/apiKeys.ts", { hashApiKey: (value) => value });
stubModule("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => null });
stubModule("src/utils/controllers/logs/createLog.ts", { default: async () => {} });

const jiti = require("jiti")(
  path.join(root, "tests/mcp-usage-auth-entry.cjs"),
  {
    alias: { "@": path.join(root, "src") },
    cache: false,
    interopDefault: true,
  },
);

const restoreModules = () => {
  for (const [filename, original] of originalModules) {
    if (original) {
      require.cache[filename] = original;
    } else {
      delete require.cache[filename];
    }
  }
};

let checkMcpRateLimit;
let extractBearerToken;
let isManagementKeyToken;
let validateMcpAuth;
let validateUsageReadAuth;
try {
  ({
    checkMcpRateLimit,
    extractBearerToken,
    isManagementKeyToken,
    validateMcpAuth,
    validateUsageReadAuth,
  } = jiti(path.join(root, authPath)));
} catch (error) {
  restoreModules();
  throw error;
}

function request(token = "htmk_test", userAgent) {
  return new NextRequest("https://app.hypertask.ai/api/mcp/usage", {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(userAgent ? { "User-Agent": userAgent } : {}),
    },
  });
}

test.after(restoreModules);

test.beforeEach(() => {
  permissionsByToken.clear();
  rejectedTokens.clear();
  rateLimitKeys.length = 0;
  configuredUser = DEFAULT_USER;
});

test("the shared bearer parser keeps rate limiting aligned with auth", async () => {
  assert.equal(extractBearerToken("bearer htmk_test"), "htmk_test");
  assert.equal(extractBearerToken("Bearer htk_test"), "htk_test");
  assert.equal(extractBearerToken("Basic htmk_test"), null);

  const lowerCaseSchemeRequest = new NextRequest(
    "https://app.hypertask.ai/api/mcp/ai/usage",
    { headers: { Authorization: "bearer htmk_test" } },
  );
  assert.equal(await checkMcpRateLimit(lowerCaseSchemeRequest), null);
  assert.equal(rateLimitKeys.length, 1);
  assert.equal(
    rateLimitKeys[0].split(":")[2],
    createHash("sha256").update("htmk_test").digest("hex"),
  );
});

test("management-key classification is limited to the management prefix", () => {
  assert.equal(isManagementKeyToken("htmk_test"), true);
  assert.equal(isManagementKeyToken("htk_test"), false);
  assert.equal(isManagementKeyToken("Bearer htmk_test"), false);
  assert.equal(isManagementKeyToken(""), false);
});

test("successful MCP auth records a recognized CLI after credential validation", async () => {
  permissionsByToken.set("htmk_test", {
    data: ["read", "write"],
    management: ["read", "write"],
  });
  const calls = [];
  const originalInfo = console.info;
  console.info = (...args) => calls.push(args);
  try {
    const ctx = await validateMcpAuth(request("htmk_test", "htz/0.2.0"));
    assert.equal(ctx?.user.id, 6);
  } finally {
    console.info = originalInfo;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "[MCP CLI Usage]");
  assert.equal(calls[0][1].client, "htz");
  assert.equal(calls[0][1].userId, 6);
});

test("usage auth accepts usage-scoped and legacy data-management keys", async () => {
  permissionsByToken.set("htmk_test", { usage: ["read"] });
  const context = await validateUsageReadAuth(request());
  assert.deepEqual(context?.management?.permissions, { usage: ["read"] });

  const lowerCaseSchemeRequest = new NextRequest(
    "https://app.hypertask.ai/api/mcp/usage",
    { headers: { Authorization: "bearer htmk_test" } },
  );
  assert.ok(await validateUsageReadAuth(lowerCaseSchemeRequest));

  for (const permissions of [{ usage: [] }, { usage: ["write"] }]) {
    permissionsByToken.set("htmk_test", permissions);
    assert.equal(await validateUsageReadAuth(request()), null);
  }

  permissionsByToken.set("htmk_test", { management: ["read", "write"] });
  assert.equal(await validateUsageReadAuth(request()), null);

  permissionsByToken.set("htmk_test", {
    data: ["read", "write"],
    management: ["read", "write"],
  });
  const legacyFullContext = await validateUsageReadAuth(request());
  assert.deepEqual(legacyFullContext?.management?.permissions, {
    data: ["read", "write"],
    management: ["read", "write"],
  });

  permissionsByToken.set("htmk_missing-user", { usage: ["read"] });
  assert.equal(
    await validateUsageReadAuth(request("htmk_missing-user")),
    null,
  );

  configuredUser = null;
  permissionsByToken.set("htmk_test", { usage: ["read"] });
  assert.equal(await validateUsageReadAuth(request()), null);
});

test("usage auth rejects non-management bearer tokens", async () => {
  permissionsByToken.set(regularBearerToken, { usage: ["read"] });
  const jwtRequest = new NextRequest("https://app.hypertask.ai/api/mcp/ai/usage", {
    headers: {
      Authorization: ["Bearer", regularBearerToken].join(" "),
    },
  });
  assert.equal(await validateUsageReadAuth(jwtRequest), null);
  assert.equal(
    await validateUsageReadAuth(
      new NextRequest("https://app.hypertask.ai/api/mcp/ai/usage", {
        headers: { Authorization: "Bearer htmk_invalid" },
      }),
    ),
    null,
  );
  assert.equal(
    await validateUsageReadAuth(
      new NextRequest("https://app.hypertask.ai/api/mcp/ai/usage", {
        headers: { Authorization: "Bearer htmk_verifier-error" },
      }),
    ),
    null,
  );
  for (const token of ["htmk_disabled", "htmk_expired"]) {
    rejectedTokens.add(token);
    assert.equal(await validateUsageReadAuth(request(token)), null);
  }
});
