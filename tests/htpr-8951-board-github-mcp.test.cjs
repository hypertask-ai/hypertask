const test = require("node:test");
const assert = require("node:assert/strict");
const nextServer = require("next/server");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const FLAG = "htpr-7515-connect-github-per-board";
const world = {};

const settings = {
  projectId: 15,
  version: "v1",
  canConnect: true,
  installations: [],
  connected: [],
  available: [],
  githubUnavailable: false,
};

class BoardGithubSettingsError extends Error {
  constructor(status, error, repositoryIds) {
    super(error);
    this.status = status;
    this.error = error;
    this.repositoryIds = repositoryIds;
  }
}

function reset() {
  Object.assign(world, {
    flagOn: true,
    user: { id: 10 },
    writeRoleRefusal: null,
    settings,
    saveCalls: [],
    saveError: null,
  });
}

const operation = load("src/lib/mcp/operations/projects/[projectId]/github/operation.ts", {
  "next/server": nextServer,
  "@/lib/mcp/routeWrapper": {
    wrapMcpRoute: (handler) => handler,
    checkMcpRouteRateLimit: async () => null,
    validateMcpRouteAuth: async () => ({ user: world.user, agentId: null, teamScope: null }),
  },
  "@/lib/mcp/agents/readRoleGuard": {
    requireAgentWriteRole: async () => world.writeRoleRefusal,
  },
  "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
  "@/lib/flags": { isFeatureEnabled: async () => world.flagOn },
  "@/lib/flags/definitions/htpr-7515-connect-github-per-board": {
    HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG: FLAG,
  },
  "@/lib/github/boardRepositories": {
    BoardGithubSettingsError,
    getBoardGithubSettings: async () => {
      if (world.saveError) throw world.saveError;
      return world.settings;
    },
    saveBoardGithubRepositories: async (userId, projectId, body) => {
      world.saveCalls.push({ userId, projectId, body });
      if (world.saveError) throw world.saveError;
      return world.settings;
    },
  },
});

const props = { params: Promise.resolve({ projectId: "15" }) };
const request = (body) => ({ json: async () => body });

test.beforeEach(reset);

test("the MCP route stays hidden while the board GitHub flag is off", async () => {
  world.flagOn = false;
  const response = await operation.GET(request(), props);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { success: false, error: "not_found" });
});

test("a board admin reads the connected repositories and the settings version", async () => {
  const response = await operation.GET(request(), props);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.projectId, 15);
  assert.equal(body.version, "v1");
});

test("a member who is not a board admin is refused", async () => {
  world.saveError = new BoardGithubSettingsError(403, "board_access_denied");
  const response = await operation.GET(request(), props);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { success: false, error: "board_access_denied" });
});

test("setting repositories forwards the selection and its version", async () => {
  const response = await operation.PUT(request({ repositoryIds: ["456"], version: "v1" }), props);
  assert.equal(response.status, 200);
  assert.deepEqual(world.saveCalls, [
    { userId: 10, projectId: 15, body: { repositoryIds: ["456"], version: "v1" } },
  ]);
});

test("a stale settings version keeps its refusal and repository list", async () => {
  world.saveError = new BoardGithubSettingsError(409, "stale");
  const response = await operation.PUT(request({ repositoryIds: [], version: "old" }), props);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { success: false, error: "stale" });
});

test("an agent without write role cannot set repositories", async () => {
  world.writeRoleRefusal = nextServer.NextResponse.json(
    { success: false, error: "read_only_agent" },
    { status: 403 },
  );
  const response = await operation.PUT(request({ repositoryIds: [], version: "v1" }), props);
  assert.equal(response.status, 403);
  assert.deepEqual(world.saveCalls, []);
});
