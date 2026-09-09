const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");

// Per-test state read by the stubbed modules below at request time.
const state = {
  user: null,
  visibilityResult: null,
  agentRow: null,
  flagEnabled: true,
};

function transpile(relativePath) {
  const filePath = path.join(root, relativePath);
  const source = fs.readFileSync(filePath, "utf8");
  return ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
}

function loadReal(relativePath) {
  const filePath = path.join(root, relativePath);
  const loaded = new Module(filePath, null);
  loaded.filename = filePath;
  loaded.require = (request) => {
    if (request === "@/lib/prisma") return { __esModule: true, default: {} };
    return require(request);
  };
  loaded._compile(transpile(relativePath), filePath);
  return loaded.exports;
}

function loadHandler({ user, visibilityResult, agentRow, flagEnabled } = {}) {
  state.user =
    user ?? { user: { id: 6, email: "owner@example.test" }, agentId: null };
  state.visibilityResult =
    visibilityResult ?? { ok: true, visibility: "PRIVATE" };
  state.flagEnabled = flagEnabled ?? true;
  state.agentRow = agentRow ?? {
    id: "agent-1",
    displayName: "GLM Dev 1",
    photoURL: null,
    revokedAt: null,
    archivedAt: null,
    runtimeType: "managed",
    mcpTokenHash: null,
    mcpTokenJti: "jti-1",
  };

  const filePath = path.join(root, "src/lib/mcp/agents/lifecycleRequests.ts");
  const loaded = new Module(filePath, null);
  loaded.filename = filePath;
  loaded.require = (request) => {
    if (request === "@/lib/agents/visibility") {
      // The real helper's ownership/provider-key behavior has its own
      // dedicated coverage in tests/agent-visibility.test.ts; here the
      // lifecycle routing and status mapping are what is under test.
      return {
        __esModule: true,
        AGENT_VISIBILITIES: ["PRIVATE", "TEAM"],
        TEAM_VISIBILITY_KEY_REQUIRED_ERROR:
          "Enable a provider key before sharing this agent with the team",
        isAgentVisibility: (value) => value === "PRIVATE" || value === "TEAM",
        // Mirror the real composition in src/lib/agents/visibility.ts so the
        // enum rule is not silently duplicated or dropped here.
        isVisibilityOnlyBody: (body) =>
          Object.values(body).filter((value) => value !== undefined).length ===
            1 && (body.visibility === "PRIVATE" || body.visibility === "TEAM"),
        setOwnedAgentVisibility: async () => state.visibilityResult,
      };
    }
    if (request === "@/lib/flags") {
      return {
        __esModule: true,
        AGENT_VISIBILITY_FLAG: "htpr-6268-agent-visibility",
        isFeatureEnabled: async () => state.flagEnabled,
      };
    }
    if (request === "@/lib/agents/runtimeState") {
      return { __esModule: true, clearAgentRuntimeSnapshot: async () => {} };
    }
    if (request === "@/lib/mcp/auth") {
      return {
        __esModule: true,
        checkMcpRateLimit: async () => null,
        validateMcpAuth: async () => state.user,
        agentTokenCredentialFields: () => ({}),
        createMcpToken: async () => "token",
      };
    }
    if (request === "@/lib/prisma") {
      return {
        __esModule: true,
        default: { agent: { findFirst: async () => state.agentRow } },
      };
    }
    if (request === "@/utils/controllers/agents/boardMembers") {
      return { __esModule: true, getAccessibleAgentBoard: async () => null };
    }
    if (request === "./lifecycle") {
      return {
        __esModule: true,
        archiveOwnedAgent: async () => {
          throw new Error("not exercised by these tests");
        },
        launchOwnedAgent: async () => {
          throw new Error("not exercised by these tests");
        },
        renameOwnedAgent: async () => {
          throw new Error("not exercised by these tests");
        },
      };
    }
    if (request === "./updateBoards") {
      return loadReal("src/lib/mcp/agents/updateBoards.ts");
    }
    if (request.startsWith("@/")) {
      const resolved = "src" + request.slice(1);
      return loadReal(resolved.endsWith(".ts") ? resolved : resolved + ".ts");
    }
    return require(request);
  };
  loaded._compile(transpile("src/lib/mcp/agents/lifecycleRequests.ts"), filePath);
  return loaded.exports;
}

function request(body) {
  return new NextRequest("https://app.hypertask.ai/api/mcp/agents/agent-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("a visibility-only patch updates visibility and describes the agent", async () => {
  const { handlePatchAgentRequest } = loadHandler({
    visibilityResult: { ok: true, visibility: "TEAM" },
  });
  const response = await handlePatchAgentRequest(
    request({ visibility: "TEAM" }),
    "agent-1"
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.agent.id, "agent-1");
  assert.equal(body.agent.display_name, "GLM Dev 1");
  assert.equal(body.agent.visibility, "TEAM");
});

test("the 409 that refuses team sharing passes through untouched", async () => {
  const { handlePatchAgentRequest } = loadHandler({
    visibilityResult: {
      ok: false,
      status: 409,
      error: "Enable a provider key before sharing this agent with the team",
    },
  });
  const response = await handlePatchAgentRequest(
    request({ visibility: "TEAM" }),
    "agent-1"
  );
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.match(body.error, /provider key/);
});

test("a visibility misspelling is a 400 field error", async () => {
  const { handlePatchAgentRequest } = loadHandler();
  const response = await handlePatchAgentRequest(
    request({ visibility: "PUBLIC" }),
    "agent-1"
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.code, "invalid_field");
  assert.equal(body.field, "visibility");
});

test("visibility cannot hide extra fields, recognized or not", async () => {
  const { handlePatchAgentRequest } = loadHandler();
  for (const body of [
    { visibility: "TEAM", display_name: "Renamed" },
    { visibility: "TEAM", archived: false },
    { visibility: "TEAM", typo_field: true },
  ]) {
    const response = await handlePatchAgentRequest(request(body), "agent-1");
    assert.equal(response.status, 400, JSON.stringify(body));
    const parsed = await response.json();
    assert.equal(parsed.code, "invalid_field");
  }
});

test("with the flag off the verb does not exist, whatever the body says (fail closed)", async () => {
  const { handlePatchAgentRequest } = loadHandler({ flagEnabled: false });
  for (const body of [
    { visibility: "TEAM" },
    { visibility: "TEAM", archived: true },
    { visibility: "TEAM", add_project_ids: ["project-1"] },
  ]) {
    const response = await handlePatchAgentRequest(request(body), "agent-1");
    assert.equal(response.status, 404, JSON.stringify(body));
    const parsed = await response.json();
    assert.equal(parsed.success, false);
    assert.equal(parsed.error, "Agent not found");
  }
});

test("an agent credential may not manage agents", async () => {
  const { handlePatchAgentRequest } = loadHandler({
    user: { user: { id: 6, email: "owner@example.test" }, agentId: "agent-9" },
  });
  const response = await handlePatchAgentRequest(
    request({ visibility: "TEAM" }),
    "agent-1"
  );
  assert.equal(response.status, 403);
});

test("a visibility change for an agent the user does not own is 404", async () => {
  const { handlePatchAgentRequest } = loadHandler({
    visibilityResult: { ok: false, status: 404, error: "Agent does not exist" },
  });
  const response = await handlePatchAgentRequest(
    request({ visibility: "PRIVATE" }),
    "agent-1"
  );
  assert.equal(response.status, 404);
});
