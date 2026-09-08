const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const routePath = "src/lib/mcp/agents/rotateToken.ts";
const stubbedPaths = [
  routePath,
  "src/lib/mcp/auth.ts",
  "src/lib/mcp/managementPermissions.ts",
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

const teamWhere = {
  members: {
    some: { project: { teamId: "team-a" } },
    none: {
      project: {
        OR: [{ teamId: null }, { teamId: { not: "team-a" } }],
      },
    },
  },
};
let foundAgent = null;
let findArgs;
let updateArgs;
let updateCount = 1;
let mintArgs;

stubModule("src/lib/mcp/auth.ts", {
  agentTokenCredentialFields: () => ({ mcpTokenHash: "digest" }),
  checkMcpRateLimit: async () => null,
  createMcpToken: (...args) => {
    mintArgs = args;
    return "one-time-agent-token";
  },
  managementAgentTokenScope: (management) =>
    management?.teamId
      ? {
          teamId: management.teamId,
          accessBinding: management.teamAccessBinding,
        }
      : undefined,
  validateManagementOrSessionAuth: async () => ({
    user: { id: 6, email: "owner@example.test" },
    agentId: null,
    management: {
      keyId: "1",
      teamId: "team-a",
      teamAccessBinding: "member:membership-a",
      permissions: { management: ["read", "write"] },
    },
  }),
  validateMcpAuth: async () => null,
});
stubModule("src/lib/mcp/managementPermissions.ts", {
  hasManagementWritePermission: () => true,
});
stubModule("src/lib/mcp/managementKeyTeamScope.ts", {
  agentWithinTeamWhere: () => teamWhere,
});
stubModule("src/lib/prisma.ts", {
  default: {
    agent: {
      findFirst: async (args) => {
        findArgs = args;
        return foundAgent;
      },
      updateMany: async (args) => {
        updateArgs = args;
        return { count: updateCount };
      },
    },
  },
});

const jiti = require("jiti")(
  path.join(root, "tests/team-management-agent-rotation.test.cjs"),
  {
    alias: { "@": path.join(root, "src") },
    cache: false,
    interopDefault: true,
  },
);
const { handleRotateAgentTokenRequest } = jiti(path.join(root, routePath));

test.after(() => {
  for (const [filename, original] of originalModules) {
    if (original) require.cache[filename] = original;
    else delete require.cache[filename];
  }
});

function request() {
  return new NextRequest("https://app.hypertask.ai/api/mcp/agents/rotate-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent_id: "agent-1" }),
  });
}

test("team-key rotation rejects an out-of-team agent without writing", async () => {
  foundAgent = null;
  findArgs = undefined;
  updateArgs = undefined;
  updateCount = 1;
  mintArgs = undefined;

  const response = await handleRotateAgentTokenRequest(
    request(),
    undefined,
    "management",
  );

  assert.equal(response.status, 404);
  assert.deepEqual(findArgs.where, {
    id: "agent-1",
    userId: 6,
    runtimeType: "EXTERNAL",
    ...teamWhere,
  });
  assert.equal(updateArgs, undefined);
});

test("team-key rotation repeats its team predicate on the write", async () => {
  foundAgent = { id: "agent-1", runtimeGeneration: 7 };
  findArgs = undefined;
  updateArgs = undefined;
  updateCount = 1;
  mintArgs = undefined;

  const response = await handleRotateAgentTokenRequest(
    request(),
    undefined,
    "management",
  );

  assert.equal(response.status, 200);
  assert.deepEqual(findArgs.select, { id: true, runtimeGeneration: true });
  assert.deepEqual(updateArgs.where, {
    id: "agent-1",
    userId: 6,
    runtimeType: "EXTERNAL",
    runtimeGeneration: 7,
    ...teamWhere,
  });
  assert.deepEqual(updateArgs.data, {
    mcpTokenHash: "digest",
    mcpTokenExpiresAt: null,
    revokedAt: null,
    runtimeGeneration: { increment: 1 },
  });
  assert.deepEqual(mintArgs, [
    6,
    "owner@example.test",
    undefined,
    "agent-1",
    { teamId: "team-a", accessBinding: "member:membership-a" },
  ]);
});

test("team-key rotation stops if the agent changes before the write", async () => {
  foundAgent = { id: "agent-1", runtimeGeneration: 7 };
  findArgs = undefined;
  updateArgs = undefined;
  updateCount = 0;
  mintArgs = undefined;

  const response = await handleRotateAgentTokenRequest(
    request(),
    undefined,
    "management",
  );

  assert.equal(response.status, 404);
  assert.equal(updateArgs.where.runtimeGeneration, 7);
});
