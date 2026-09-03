// Behavioral coverage for createAgentForUser (src/lib/mcp/agents/create.ts),
// the endpoint the Agent Chat "+" create-agent modal calls: the one-time
// token on success, and the validation failures that must reject before ever
// touching the database.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

const source = fs.readFileSync(
  path.join(root, "src/lib/mcp/agents/create.ts"),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

function loadCreateModule({
  prisma,
  mintedToken = "minted-token",
  validateManagementOrSessionAuth = async () => null,
  hasManagementWritePermission = () => true,
} = {}) {
  const mod = { exports: {} };
  const mockRequire = (request) => {
    if (request === "@/lib/mcp/auth") {
      return {
        checkMcpRateLimit: async () => null,
        validateManagementOrSessionAuth,
        validateMcpAuth: async () => null,
        createMcpToken: () => mintedToken,
        agentTokenCredentialFields: () => ({
          mcpTokenHash: "hash",
          mcpTokenJti: "jti",
        }),
      };
    }
    if (request === "@/lib/mcp/fieldError") {
      return {
        buildFieldError: (code, field, message) => ({
          success: false,
          error: message,
          field,
          code,
        }),
      };
    }
    if (request === "@/lib/mcp/managementPermissions") {
      return { hasManagementWritePermission };
    }
    if (request === "@/lib/prisma") {
      // esModuleInterop's __importDefault wraps a plain object as
      // { default: mod } itself, so the mock must NOT pre-wrap it.
      return prisma;
    }
    if (request === "@/utils/controllers/agents/boardMembers") {
      return { getAccessibleAgentBoard: async () => null };
    }
    if (request === "@/utils/controllers/agents/teamScope") {
      return {
        canAttachAgentToTeam: () => true,
        getAgentTeamId: () => null,
      };
    }
    return require(request);
  };
  new Function("module", "exports", "require", javascript)(
    mod,
    mod.exports,
    mockRequire,
  );
  return mod.exports;
}

function request(body) {
  return { json: async () => body };
}

test("rejects a missing display_name before touching the database", async () => {
  const { createAgentForUser } = loadCreateModule({ prisma: {} });
  const res = await createAgentForUser(request({}), { id: 6, email: "a@b.com" });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.field, "display_name");
});

test("rejects a non-string display_name before touching the database", async () => {
  const { createAgentForUser } = loadCreateModule({ prisma: {} });
  const res = await createAgentForUser(
    request({ display_name: 42 }),
    { id: 6, email: "a@b.com" },
  );
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.field, "display_name");
});

test("rejects a display_name over 60 characters before touching the database", async () => {
  const { createAgentForUser } = loadCreateModule({ prisma: {} });
  const res = await createAgentForUser(
    request({ display_name: "x".repeat(61) }),
    { id: 6, email: "a@b.com" },
  );
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.field, "display_name");
});

test("a duplicate display name is rejected with a rotate-token pointer, not silently reissued", async () => {
  const prisma = {
    agent: {
      findFirst: async () => ({ id: "existing-agent" }),
    },
  };
  const { createAgentForUser } = loadCreateModule({ prisma });
  const res = await createAgentForUser(
    request({ display_name: "Build Agent" }),
    { id: 6, email: "a@b.com" },
  );
  assert.equal(res.status, 409);
  const data = await res.json();
  assert.match(data.error, /rotate/i);
});

test("a successful create returns the token exactly once, alongside the agent", async () => {
  const prisma = {
    agent: {
      findFirst: async () => null,
      create: async ({ data }) => ({
        id: "new-agent",
        displayName: data.displayName,
        photoURL: null,
      }),
      update: async () => ({}),
    },
    $transaction: async (fn) => fn(prisma),
  };
  const { createAgentForUser } = loadCreateModule({
    prisma,
    mintedToken: "one-time-token",
  });
  const res = await createAgentForUser(
    request({ display_name: "Build Agent" }),
    { id: 6, email: "a@b.com" },
  );
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.agent.id, "new-agent");
  assert.equal(data.token, "one-time-token");
  // The response is the only place the token appears; nothing else in the
  // payload repeats or derives it.
  assert.doesNotMatch(JSON.stringify(data.agent), /one-time-token/);
});

test("the browser-session route rejects an unauthenticated request before any validation", async () => {
  const { handleCreateAgentRequest } = loadCreateModule({
    prisma: {},
    validateManagementOrSessionAuth: async () => null,
  });
  const res = await handleCreateAgentRequest(
    request({ display_name: "Build Agent" }),
    "management",
  );
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.success, false);
});

test("a management key without write permission is rejected before creating anything", async () => {
  const { handleCreateAgentRequest } = loadCreateModule({
    prisma: {},
    validateManagementOrSessionAuth: async () => ({
      user: { id: 6, email: "a@b.com" },
      management: { permissions: [] },
    }),
    hasManagementWritePermission: () => false,
  });
  const res = await handleCreateAgentRequest(
    request({ display_name: "Build Agent" }),
    "management",
  );
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.success, false);
});

test("an authorized browser session (no management key) can create an agent and gets its token", async () => {
  const prisma = {
    agent: {
      findFirst: async () => null,
      create: async ({ data }) => ({
        id: "new-agent",
        displayName: data.displayName,
        photoURL: null,
      }),
      update: async () => ({}),
    },
    $transaction: async (fn) => fn(prisma),
  };
  const { handleCreateAgentRequest } = loadCreateModule({
    prisma,
    mintedToken: "session-token",
    // No `management` key on the context: this is the browser's own session
    // cookie, which validateManagementOrSessionAuth accepts as a fallback
    // when no Authorization header is sent.
    validateManagementOrSessionAuth: async () => ({
      user: { id: 6, email: "a@b.com" },
    }),
  });
  const res = await handleCreateAgentRequest(
    request({ display_name: "Build Agent" }),
    "management",
  );
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.token, "session-token");
});
