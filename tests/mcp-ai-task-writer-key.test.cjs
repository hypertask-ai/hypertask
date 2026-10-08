const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const userId = 1000;
const projectId = 3854;
const teamId = "team_without_inference_key";
const sharedKey = "vck_fixture_shared_allowance";
const reports = [];
const keyLookups = [];
let plan = "Pro";
let teamKeys = {};
let agentId = null;
let preparationError = null;
let inferenceCalls = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stubModule("src/lib/prisma.ts", {
  default: {
    project: {
      findFirst: async ({ where }) => {
        assert.equal(where.id, projectId);
        return { id: projectId, teamId, team: { aiProviderSettings: {} } };
      },
    },
    team: {
      findUnique: async ({ where }) => {
        assert.equal(where.id, teamId);
        return {
          id: teamId,
          compedPlan: plan === "BYOK" ? "BYOK" : null,
          compedUntil: plan === "BYOK" ? new Date("2099-01-01") : null,
          activeSubscriptionPlanId: plan === "Pro" ? "sub_fixture_pro" : null,
          subscriptionPlan: plan === "Pro" ? [{
            subscriptionId: "sub_fixture_pro",
            subscriptionStatus: "active",
            priceId: "price_1QjJeDIhmcH60VcciHzZ3mTJ",
          }] : [],
        };
      },
    },
    teamByokApiKey: {
      findUnique: async ({ where }) => {
        const { teamId: lookupTeam, provider } = where.teamId_provider;
        assert.equal(lookupTeam, teamId);
        keyLookups.push(provider);
        return teamKeys[provider] ? { enabled: true, ciphertext: teamKeys[provider] } : null;
      },
    },
    userSetting: { findUnique: async () => null },
  },
});
stubModule("src/lib/crypto/byokCipher.ts", { decryptByokSecret: (value) => value });
stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
  getProjectWhere: (id) => ({ ownerId: id }),
  taskWriteAccessWhere: (id) => ({ ownerId: id }),
  projectContentAccessWhere: (id) => ({ ownerId: id }),
});
stubModule("src/lib/flags.ts", { isFeatureEnabled: async () => false });
stubModule("src/lib/errors/reportError.ts", { reportError: async (report) => reports.push(report) });
stubModule("src/app/api/ai/_lib/aiUsage.ts", { logAiUsage: async () => {} });
stubModule("src/lib/telemetry/aiChatObservability.ts", {});
stubModule("src/utils/controllers/turbopuffer/turbopufferHelper.ts", {});
stubModule("src/app/api/ai/_lib/customInstructions.ts", {});
stubModule("src/app/api/ai/_lib/currentTaskContext.ts", {});
stubModule("src/app/api/ai/_lib/skills.ts", {});
stubModule("src/app/api/ai/_lib/boardTemplateContext.ts", { BOARD_TEMPLATE_LIMIT: 10 });
stubModule("src/app/api/ai/_lib/requestUser.ts", { getAiRequestUser: async () => ({ id: userId }) });
stubModule("src/lib/mcp/routeWrapper.ts", {
  wrapMcpRoute: (handler) => handler,
  validateMcpRouteAuth: async () => ({ user: { id: userId }, agentId }),
  checkMcpRouteRateLimit: async () => null,
});
stubModule("src/lib/mcp/auth.ts", { createUnauthorizedResponse: () => Response.json({}, { status: 401 }) });

const ai = require("ai");
require.cache[require.resolve("ai")].exports = {
  ...ai,
  generateText: async () => { inferenceCalls += 1; throw new Error("Unexpected inference"); },
  streamText: () => { inferenceCalls += 1; throw new Error("Unexpected inference"); },
};
const load = createJiti(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false });
const harness = load(path.join(root, "src/app/api/ai/_lib/taskWriterRun.ts"));
stubModule("src/app/api/ai/_lib/taskWriterRun.ts", {
  ...harness,
  prepareTaskWriterRun: async (...args) => {
    if (preparationError) throw preparationError;
    return harness.prepareTaskWriterRun(...args);
  },
});
const { selectTaskWriterModel } = load(path.join(root, "src/app/api/ai/_lib/editorAi.ts"));
const { getByokOrTeamGatewayApiKeyForProvider } = load(path.join(root, "src/app/api/ai/_lib/byokKeys.ts"));
const { AiGatewayKeyRequiredError, resolveAiModel, resolveGatewayModel } = load(path.join(root, "src/app/api/ai/_lib/modelProvider.ts"));
const { AiPlanAccessError } = load(path.join(root, "src/app/api/ai/_lib/planGate.ts"));
const mcp = load(path.join(root, "src/app/api/mcp/ai/task-writer/route.ts"));
const web = load(path.join(root, "src/app/api/ai/task-writer/route.ts"));

const savedEnv = { AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY };
test.beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = sharedKey;
  plan = "Pro";
  teamKeys = {};
  agentId = null;
  preparationError = null;
  inferenceCalls = 0;
  reports.length = 0;
  keyLookups.length = 0;
});
test.after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function request() {
  return { json: async () => ({
    projectId,
    PROMPT: "Draft a task",
  }) };
}
function mcpRequest() {
  return { json: async () => ({ project_id: projectId, prompt: "Draft a task" }) };
}

async function assertAccessResponse(route, req, message) {
  const response = await route.POST(req);
  assert.equal(response.status, 403);
  const content = await response.text();
  if (route === mcp) {
    const payload = JSON.parse(content);
    assert.equal(payload.success, false);
    assert.equal(payload.error, message);
  } else {
    const frame = content.split("\n").find((line) => line.startsWith("data: "));
    assert.ok(frame, content);
    assert.equal(JSON.parse(frame.slice(6)).content, message);
  }
  assert.equal(inferenceCalls, 0);
  assert.deepEqual(reports, []);
}

test("09:58 regression: paid team without a provisioned key fails identically before inference on MCP and web", async () => {
  const body = harness.taskWriterRequestSchema.parse({ projectId, PROMPT: "Draft a task" });
  await assert.rejects(harness.prepareTaskWriterRun(body, userId), (error) => {
    assert.ok(error instanceof AiGatewayKeyRequiredError);
    assert.equal(error.message, "A dedicated team AI Gateway key or direct BYOK key is required for openai text inference.");
    return true;
  });
  assert.ok(keyLookups.includes("managed_gateway"));
  const message = "A dedicated team AI Gateway key or direct BYOK key is required for openai text inference.";
  await assertAccessResponse(mcp, mcpRequest(), message);
  await assertAccessResponse(web, request(), message);
});

test("agent-bound MCP requests return the same missing-key access error without filing production errors", async () => {
  agentId = "agent_fixture";
  await assertAccessResponse(mcp, mcpRequest(), "A dedicated team AI Gateway key or direct BYOK key is required for openai text inference.");
});

test("authorized Free and BYOK teams resolve the shared included allowance instead of needing a dedicated key", async () => {
  for (plan of ["Free", "BYOK"]) {
    assert.equal(await getByokOrTeamGatewayApiKeyForProvider("openai", [], { trustedTeamId: teamId }), sharedKey);
    assert.equal(keyLookups.includes("managed_gateway"), false);
  }
});

test("paid teams still resolve their managed gateway or direct BYOK key, never the shared pool", async () => {
  for (const provider of ["managed_gateway", "openai"]) {
    const credential = provider === "managed_gateway" ? "vck_fixture_managed" : "fixture_direct_openai";
    teamKeys = { [provider]: credential };
    const lookup = { trustedTeamId: teamId };
    assert.equal(await getByokOrTeamGatewayApiKeyForProvider("openai", [], lookup), credential);
    const selected = await selectTaskWriterModel({ projectId, userId, aiFeature: "taskWriter" });
    assert.equal(selected.modelId, "gpt-6-luna");
    assert.ok(selected.model);
  }
});

test("both writers classify typed plan and key access errors consistently, including the gateway resolver", async () => {
  const errors = [new AiPlanAccessError("This model needs your own AI key.")];
  for (const resolver of [() => resolveAiModel("openai", "gpt-6-luna"), () => resolveGatewayModel("openai/gpt-6-luna")]) {
    try { resolver(); assert.fail("Expected key resolver to reject missing credentials"); }
    catch (error) { assert.ok(error instanceof AiGatewayKeyRequiredError); errors.push(error); }
  }
  for (const error of errors) {
    preparationError = error;
    await assertAccessResponse(mcp, mcpRequest(), error.message);
    await assertAccessResponse(web, request(), error.message);
  }
});

test("unexpected errors, even with the same key-error message, remain 500 and are reported once", async () => {
  preparationError = new Error("A dedicated team AI Gateway key or direct BYOK key is required for openai text inference.");
  for (const route of [mcp, web]) {
    reports.length = 0;
    const response = await route.POST(route === mcp ? mcpRequest() : request());
    assert.equal(response.status, 500);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].source, "handled");
    assert.equal(reports[0].extra.stage, "request");
    assert.equal(inferenceCalls, 0);
  }
});
