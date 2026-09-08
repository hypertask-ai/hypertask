const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const stubbedPaths = [
  "src/app/api/mcp/admin/tokens/route.ts",
  "src/app/api/mcp/admin/connections/route.ts",
  "src/app/api/mcp/admin/team-gateway-keys/route.ts",
  "src/lib/mcp/auth.ts",
  "src/lib/mcp/accountTokens.ts",
  "src/lib/mcp/connections.ts",
  "src/app/api/ai/_lib/managedGatewayKeys.ts",
  "src/lib/crypto/byokCipher.ts",
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

const teamContext = {
  user: { id: 6, email: "owner@example.test" },
  agentId: null,
  management: {
    keyId: "1",
    teamId: "team-a",
    permissions: { management: ["read", "write"] },
  },
};
let accountCalls = 0;

stubModule("src/lib/mcp/auth.ts", {
  checkMcpRateLimit: async () => null,
  createUnauthorizedResponse: () =>
    Response.json({ success: false }, { status: 401 }),
  validateManagementOrSessionAuth: async () => teamContext,
});
stubModule("src/lib/mcp/accountTokens.ts", {
  InvalidAccountMcpTokenError: class extends Error {},
  mintAccountMcpToken: () => {
    accountCalls += 1;
  },
  revokeAccountMcpToken: async () => {
    accountCalls += 1;
  },
});
stubModule("src/lib/mcp/connections.ts", {
  listOwnedConnections: async () => {
    accountCalls += 1;
    return [];
  },
});
stubModule("src/app/api/ai/_lib/managedGatewayKeys.ts", {
  MANAGED_TEAM_GATEWAY_PROVIDER: "vercel-ai-gateway",
});
stubModule("src/lib/crypto/byokCipher.ts", {
  decryptByokSecret: () => "",
  encryptByokSecret: () => "",
});
stubModule("src/lib/prisma.ts", {
  default: new Proxy(
    {},
    {
      get() {
        accountCalls += 1;
        throw new Error("account-wide database access must not run");
      },
    },
  ),
});

const jiti = require("jiti")(
  path.join(root, "tests/team-management-key-account-routes.test.cjs"),
  {
    alias: { "@": path.join(root, "src") },
    cache: false,
    interopDefault: true,
  },
);

const tokens = jiti(path.join(root, "src/app/api/mcp/admin/tokens/route.ts"));
const connections = jiti(
  path.join(root, "src/app/api/mcp/admin/connections/route.ts"),
);
const gateway = jiti(
  path.join(root, "src/app/api/mcp/admin/team-gateway-keys/route.ts"),
);

test.after(() => {
  for (const [filename, original] of originalModules) {
    if (original) require.cache[filename] = original;
    else delete require.cache[filename];
  }
});

function request(method, body) {
  return new NextRequest("https://app.hypertask.ai/api/mcp/admin/test", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("team keys cannot reach account-wide token, connection, or gateway routes", async () => {
  accountCalls = 0;
  const responses = [
    await tokens.POST(request("POST", { expires_in_days: 1 })),
    await tokens.DELETE(request("DELETE", { revoke_all: true })),
    await connections.GET(request("GET")),
    await gateway.GET(request("GET")),
    await gateway.POST(request("POST", { targets: [] })),
  ];

  assert.deepEqual(
    responses.map((response) => response.status),
    [403, 403, 403, 403, 403],
  );
  assert.equal(accountCalls, 0);
});
