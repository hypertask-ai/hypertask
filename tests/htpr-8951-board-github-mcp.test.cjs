const test = require("node:test");
const assert = require("node:assert/strict");
const nextServer = require("next/server");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const world = { flagOn: true };
const settings = { projectId: 15, version: "v1", canConnect: true, installations: [], connected: [], available: [], githubUnavailable: false };

class BoardGithubSettingsError extends Error {
  constructor(status, error) {
    super(error);
    this.status = status;
    this.error = error;
  }
}

const operation = load("src/lib/mcp/operations/projects/[projectId]/github/operation.ts", {
  "next/server": nextServer,
  "@/lib/mcp/routeWrapper": {
    wrapMcpRoute: (handler) => handler,
    checkMcpRouteRateLimit: async () => null,
    validateMcpRouteAuth: async () => ({ user: { id: 10 }, agentId: null, teamScope: null }),
  },
  "@/lib/mcp/agents/readRoleGuard": { requireAgentWriteRole: async () => world.writeRoleRefusal ?? null },
  "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: () => {} },
  "@/lib/flags": { isFeatureEnabled: async () => world.flagOn },
  "@/lib/flags/definitions/htpr-7515-connect-github-per-board": {
    HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG: "htpr-7515-connect-github-per-board",
  },
  "@/lib/flags/definitions/htpr-8951-board-github-repos": {
    HTPR_8951_BOARD_GITHUB_REPOS_FLAG: "htpr-8951-board-github-repos",
  },
  "@/lib/github/boardRepositories": {
    BoardGithubSettingsError,
    getBoardGithubSettings: async () => {
      if (world.error) throw world.error;
      return settings;
    },
    saveBoardGithubRepositories: async (userId, projectId, body) => {
      world.saved = { userId, projectId, body };
      if (world.error) throw world.error;
      return settings;
    },
  },
});

const props = { params: Promise.resolve({ projectId: "15" }) };
const put = (body) => operation.PUT({ json: async () => body }, props);

test.beforeEach(() => {
  world.flagOn = true;
  world.error = null;
  world.writeRoleRefusal = null;
  world.saved = null;
});

test("the route stays hidden while the board GitHub flag is off", async () => {
  world.flagOn = false;
  const response = await operation.GET({}, props);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { success: false, error: "not_found" });
});

test("a board admin reads the connected repositories and the settings version", async () => {
  const response = await operation.GET({}, props);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, ...settings });
});

test("a member who is not a board admin is refused", async () => {
  world.error = new BoardGithubSettingsError(403, "board_access_denied");
  const response = await operation.GET({}, props);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { success: false, error: "board_access_denied" });
});

test("setting repositories forwards the selection and its version", async () => {
  const response = await put({ repositoryIds: ["456"], version: "v1" });
  assert.equal(response.status, 200);
  assert.deepEqual(world.saved, { userId: 10, projectId: 15, body: { repositoryIds: ["456"], version: "v1" } });
});

test("a stale settings version keeps its refusal", async () => {
  world.error = new BoardGithubSettingsError(409, "stale");
  const response = await put({ repositoryIds: [], version: "old" });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { success: false, error: "stale" });
});

test("a read-only agent cannot set repositories", async () => {
  world.writeRoleRefusal = nextServer.NextResponse.json({ success: false, error: "read_only_agent" }, { status: 403 });
  const response = await put({ repositoryIds: [], version: "v1" });
  assert.equal(response.status, 403);
  assert.equal(world.saved, null);
});
