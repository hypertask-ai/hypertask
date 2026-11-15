const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const FLAG = "htpr-9364-agent-self-profile";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PICTURE_URL = "https://files.hypertask.app/tasks/attachments/self.png";
const state = { actingAgentId: "self-agent", enabled: true, writes: [], uploads: [], flagCalls: [], rows: new Map() };

function seed() {
  state.actingAgentId = "self-agent";
  state.enabled = true;
  state.writes = [];
  state.uploads = [];
  state.flagCalls = [];
  state.rows = new Map(["self-agent", "other-agent"].map((id) => [id, {
    id, userId: 6, displayName: id === "self-agent" ? "Old self" : "Old other", photoURL: null,
    revokedAt: null, archivedAt: null, runtimeType: "EXTERNAL", mcpTokenHash: "a".repeat(64), mcpTokenJti: "generation",
  }]));
}

const { handlePatchAgentRequest } = loadModule("src/lib/mcp/agents/lifecycleRequests.ts", {
  "@/lib/prisma": { default: {
    agent: {
      findFirst: async ({ where }) => {
        const row = state.rows.get(where.id);
        return row && row.userId === where.userId ? { ...row } : null;
      },
      updateMany: async ({ where, data }) => {
        const row = state.rows.get(where.id);
        if (!row || row.userId !== where.userId) return { count: 0 };
        Object.assign(row, data);
        state.writes.push({ id: where.id, userId: where.userId, data: { ...data } });
        return { count: 1 };
      },
    },
    user: { findUnique: async () => ({ email: "owner@example.com" }) },
  } },
  "@/lib/flags": { isFeatureEnabled: async (key, userId) => { state.flagCalls.push([key, userId]); return state.enabled; } },
  "@/lib/mcp/auth": {
    checkMcpRateLimit: async () => null,
    validateMcpAuth: async () => ({ user: { id: 6, email: "owner@example.com" }, agentId: state.actingAgentId }),
    createMcpToken: () => "token",
    managementAgentTokenScope: () => undefined,
    agentTokenCredentialFields: () => ({ mcpTokenHash: null, mcpTokenJti: null }),
  },
  "@/lib/storage/uploadTaskAttachmentToS3": {
    uploadTaskAttachmentToS3: async (buffer, fileName, contentType) => {
      state.uploads.push({ buffer, fileName, contentType });
      return PICTURE_URL;
    },
  },
  "@/lib/agents/visibility": { isVisibilityOnlyBody: () => false, setOwnedAgentVisibility: async () => ({ ok: false, status: 500, error: "unused" }) },
  "@/lib/agents/runtimeState": { clearAgentRuntimeSnapshot: async () => {} },
  "@/lib/mcp/agents/delegatedAccess": { checkAgentBoardDelegation: async () => null },
  "@/utils/controllers/agents/boardMembers": { getAccessibleAgentBoard: async () => null },
  "./updateBoards": {
    AgentBoardUpdateError: class AgentBoardUpdateError extends Error {},
    parseAgentBoardUpdateBody: () => { throw new Error("unused"); },
    updateOwnedAgentBoards: async () => { throw new Error("unused"); },
  },
});

async function call(body, agentId = "self-agent") {
  const response = await handlePatchAgentRequest({ json: async () => body }, agentId);
  return { status: response.status, body: await response.json() };
}

test("flag defaults to Everyone and names this ticket", () => {
  const loaded = loadModule("src/lib/flags/definitions/htpr-9364-agent-self-profile.ts");
  assert.equal(loaded.HTPR_9364_AGENT_SELF_PROFILE_FLAG, FLAG);
  assert.equal(loaded.default.key, FLAG);
  assert.equal(loaded.default.kind, "feature");
  assert.equal(loaded.default.defaultMode, "EVERYONE");
});

test("agent renames itself with its own key", async () => {
  seed();
  const response = await call({ display_name: "  Board Helper  " });
  assert.equal(response.status, 200);
  assert.equal(response.body.agent.id, "self-agent");
  assert.equal(response.body.agent.display_name, "Board Helper");
  assert.deepEqual(state.flagCalls, [[FLAG, 6]]);
  assert.deepEqual(state.writes, [{ id: "self-agent", userId: 6, data: { displayName: "Board Helper" } }]);
  assert.equal(state.rows.get("other-agent").displayName, "Old other");
});

test("agent sets its picture with its own key", async () => {
  seed();
  const response = await call({ picture: { content_type: "image/png", data: PNG } });
  assert.equal(response.status, 200);
  assert.equal(response.body.agent.photo_url, PICTURE_URL);
  assert.equal(state.rows.get("self-agent").photoURL, PICTURE_URL);
  assert.equal(state.rows.get("self-agent").displayName, "Old self");
  assert.equal(state.uploads.length, 1);
  assert.equal(state.uploads[0].contentType, "image/png");
  assert.equal(state.uploads[0].fileName, "agent-picture.png");
  assert.equal(state.uploads[0].buffer[0], 0x89);
});

test("one request sets the calling agent's name and picture", async () => {
  seed();
  const response = await call({ display_name: "Board Helper", picture: { content_type: "image/png", data: PNG } });
  assert.equal(response.status, 200);
  assert.equal(response.body.agent.display_name, "Board Helper");
  assert.equal(response.body.agent.photo_url, PICTURE_URL);
  assert.deepEqual(state.writes.map((write) => write.data), [{ displayName: "Board Helper" }, { photoURL: PICTURE_URL }]);
});

test("agent is refused when it targets another agent", async () => {
  seed();
  const byPath = await call({ display_name: "Stolen", picture: { content_type: "image/png", data: PNG } }, "other-agent");
  assert.equal(byPath.status, 403);
  assert.equal(byPath.body.error, "Agents can only update their own profile");
  const byBody = await call({ display_name: "Stolen", agent_id: "other-agent" }, "self-agent");
  assert.equal(byBody.status, 403);
  assert.equal(state.writes.length, 0);
  assert.equal(state.uploads.length, 0);
  assert.equal(state.rows.get("self-agent").displayName, "Old self");
  assert.equal(state.rows.get("other-agent").displayName, "Old other");
  assert.equal(state.rows.get("other-agent").photoURL, null);
});

test("human admin rename still works", async () => {
  seed();
  state.actingAgentId = null;
  state.enabled = false;
  const response = await call({ display_name: "  Release Helper  " }, "self-agent");
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.agent.display_name, "Release Helper");
  assert.equal(state.rows.get("self-agent").displayName, "Release Helper");
  assert.deepEqual(state.flagCalls, []);
  assert.deepEqual(state.writes, [{ id: "self-agent", userId: 6, data: { displayName: "Release Helper" } }]);
});

test("bad name and bad file type are refused", async () => {
  seed();
  for (const display_name of ["   ", "x".repeat(61), 42]) {
    const response = await call({ display_name });
    assert.equal(response.status, 400);
    assert.equal(response.body.field, "display_name");
  }
  const pdf = await call({ picture: { content_type: "application/pdf", data: Buffer.from("%PDF-1.4").toString("base64") } });
  assert.equal(pdf.status, 400);
  assert.equal(pdf.body.field, "picture.content_type");
  assert.equal(state.writes.length, 0);
  assert.equal(state.uploads.length, 0);
  assert.equal(state.rows.get("self-agent").displayName, "Old self");
});

test("flag off keeps the self-rename refusal", async () => {
  seed();
  state.enabled = false;
  const response = await call({ display_name: "Board Helper" });
  assert.equal(response.status, 403);
  assert.equal(response.body.error, "Agents cannot manage agents");
  assert.deepEqual(state.flagCalls, [[FLAG, 6]]);
  assert.equal(state.writes.length, 0);
});
