const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

const stubbedModulePaths = [
  "src/app/api/ai/_lib/byokKeys.ts",
  "src/app/api/ai/_lib/modelProvider.ts",
  "src/app/api/ai/_lib/planGate.ts",
  "src/lib/crypto/byokCipher.ts",
  "src/lib/prisma.ts",
  "src/lib/agents/ownedSlugs.ts",
  "src/utils/controllers/projects/getAllIncludes.ts",
];

function resetModules() {
  for (const relativePath of stubbedModulePaths) {
    delete require.cache[path.join(root, relativePath)];
  }
  stubModule("src/lib/ai/teamAiFunding.ts", require("./helpers/team-ai-funding-stub.cjs"));
}

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function stubPlan(plan = "Pro") {
  stubModule("src/app/api/ai/_lib/planGate.ts", {
    assertImageModelAllowedForPlan: async () => {},
    assertModelAllowedForPlan: async () => {},
    haiku55ModelEnabled: async () => false,
    storePlanIdForProject: async () => plan,
  });
}

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-entry-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } },
  );
  return jiti(path.join(root, relativePath));
}

/**
 * @param agentRows map of `${agentId}:${provider}` -> row
 * @param teamRows map of provider -> row
 */
function stubKeyTables(agentRows, teamRows, calls = { agent: [], team: [] }) {
  stubModule("src/lib/prisma.ts", {
    default: {
      agentByokApiKey: {
        findUnique: async ({ where }) => {
          const { agentId, provider } = where.agentId_provider;
          calls.agent.push({ agentId, provider });
          return agentRows[`${agentId}:${provider}`] ?? null;
        },
      },
      teamByokApiKey: {
        findUnique: async ({ where }) => {
          const { provider } = where.teamId_provider;
          calls.team.push({ provider });
          return teamRows[provider] ?? null;
        },
      },
      team: { findUnique: async () => ({ aiProviderSettings: null }) },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
    encryptByokSecret: (plaintext) => plaintext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });
  return calls;
}

test("an agent's own OpenRouter key is used instead of the team key", async () => {
  resetModules();
  stubPlan();
  const calls = stubKeyTables(
    { "agent-1:openrouter": { enabled: true, ciphertext: "sk-or-agent" } },
    { openrouter: { enabled: true, ciphertext: "sk-or-team" } },
  );

  const { getByokOrTeamGatewayApiKey } = loadTs(
    "src/app/api/ai/_lib/byokKeys.ts",
  );

  assert.equal(
    await getByokOrTeamGatewayApiKey("openrouter", [], {
      trustedTeamId: "team-1",
      userId: 6,
      agentId: "agent-1",
    }),
    "sk-or-agent",
  );
  assert.deepEqual(calls.agent, [
    { agentId: "agent-1", provider: "openrouter" },
  ]);
});

test("an agent key beats a request-supplied provider flag for the same provider", async () => {
  resetModules();
  stubPlan();
  stubKeyTables(
    { "agent-1:openrouter": { enabled: true, ciphertext: "sk-or-agent" } },
    {},
  );

  const { getByokApiKeyForProvider } = loadTs(
    "src/app/api/ai/_lib/byokKeys.ts",
  );

  assert.equal(
    await getByokApiKeyForProvider(
      "openrouter",
      [{ provider: "openrouter", enabled: true, ciphertext: "sk-or-request" }],
      { trustedTeamId: "team-1", userId: 6, agentId: "agent-1" },
    ),
    "sk-or-agent",
  );
});

test("an agent without its own key still falls back to the team key", async () => {
  resetModules();
  stubPlan();
  stubKeyTables({}, { openrouter: { enabled: true, ciphertext: "sk-or-team" } });

  const { getByokOrTeamGatewayApiKey } = loadTs(
    "src/app/api/ai/_lib/byokKeys.ts",
  );

  assert.equal(
    await getByokOrTeamGatewayApiKey("openrouter", [], {
      trustedTeamId: "team-1",
      userId: 6,
      agentId: "agent-2",
    }),
    "sk-or-team",
  );
});

test("a disabled agent key is ignored and does not leak to another provider", async () => {
  resetModules();
  stubPlan();
  stubKeyTables(
    {
      "agent-1:openrouter": { enabled: false, ciphertext: "sk-or-agent" },
      "agent-1:openai": { enabled: true, ciphertext: "sk-openai-agent" },
    },
    { openrouter: { enabled: true, ciphertext: "sk-or-team" } },
  );

  const { getByokOrTeamGatewayApiKey } = loadTs(
    "src/app/api/ai/_lib/byokKeys.ts",
  );

  assert.equal(
    await getByokOrTeamGatewayApiKey("openrouter", [], {
      trustedTeamId: "team-1",
      userId: 6,
      agentId: "agent-1",
    }),
    "sk-or-team",
  );
});

test("another user's agent id resolves no key at all", async () => {
  resetModules();
  stubPlan();
  stubKeyTables(
    { "agent-other:openrouter": { enabled: true, ciphertext: "sk-or-other" } },
    {},
  );

  const { getByokOrTeamGatewayApiKey } = loadTs(
    "src/app/api/ai/_lib/byokKeys.ts",
  );

  assert.equal(
    await getByokOrTeamGatewayApiKey("openrouter", [], {
      trustedTeamId: "team-1",
      userId: 6,
      agentId: "agent-1",
    }),
    undefined,
  );
});

test("task-writer selection passes the acting agent through to key lookup", async () => {
  resetModules();
  stubPlan();
  const calls = { agent: [], team: [] };
  stubKeyTables(
    { "agent-1:openrouter": { enabled: true, ciphertext: "sk-or-agent" } },
    { openrouter: { enabled: true, ciphertext: "sk-or-team" } },
    calls,
  );
  const prismaStub = require.cache[path.join(root, "src/lib/prisma.ts")]
    .exports.default;
  prismaStub.project = {
    findFirst: async () => ({ teamId: "team-1", team: null }),
  };
  prismaStub.userSetting = { findUnique: async () => null };

  const { selectTaskWriterModel } = loadTs("src/app/api/ai/_lib/editorAi.ts");

  await selectTaskWriterModel({
    sourceSelected: "openrouter",
    modelSelected: "openai/gpt-5.5",
    projectId: 15,
    userId: 6,
    agentId: "agent-1",
    feature: "hyper-mentioned",
  });

  assert.ok(
    calls.agent.some(
      (call) => call.agentId === "agent-1" && call.provider === "openrouter",
    ),
    "expected the acting agent's openrouter key to be looked up",
  );
});

test("the agents list exposes only a masked key, and only to the owner", async () => {
  const { load } = require("./task-route-loader.cjs");
  const rows = [6, 7].map(userId => ({
    id: `agent-${userId}`, userId, displayName: "Runner", createdAt: new Date("2026-10-01"),
    revokedAt: null, heartbeatAt: null, mcpTokenJti: "private-token-id", mcpTokenExpiresAt: null,
    permissions: {}, byokApiKeys: [{ provider: "openrouter", ciphertext: "fixture-key-1234" }],
    crossTeamHomeTeamId: "team", crossTeamAccessGranted: false,
    members: [{ project: { id: 15, teamId: "team", name: "Board" } }],
  }));
  const queries = [];
  const route = load("src/app/api/agents/route.ts", {
    "@/lib/prisma": { default: {
      agent: { findMany: async query => { queries.push(query); return rows; } },
      comment: { groupBy: async () => [] }, oAuthAuthorizationCode: { findMany: async () => [] },
    } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 6 }) },
    "@/lib/flags": { isOwnerOrQaUserId: async () => false, isFeatureEnabled: async () => false },
    "@/lib/agents/crossTeam": { crossTeamAgentsEnabled: async () => false },
    "@/lib/crypto/byokCipher": { decryptByokSecret: value => value },
    "@/lib/mcp/auth": {},
    "@/utils/controllers/agents/boardMembers": {},
    "@/utils/controllers/agents/ensureDefaultTeamAgent": {},
    "@/utils/controllers/teams/hasTeamMembershipAccess": { hasTeamMembershipAccess: async () => true },
    "@/lib/agents/visibility": { boardAgentVisibilityWhere: () => ({}) },
  });
  const response = await route.GET({ headers: new Headers(), url: "https://fixture.invalid/api/agents?teamId=team" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(queries[0].select.byokApiKeys.where, { enabled: true });
  assert.deepEqual(body.agents.map(agent => agent.providerKey), [{ provider: "openrouter", maskedKey: "••••••••1234" }, null]);
  assert.doesNotMatch(JSON.stringify(body), /fixture-key|ciphertext|byokApiKeys|private-token-id|crossTeamHomeTeamId|crossTeamAccessGranted/);
});

test("a team in GDPR safe mode blocks a restricted agent key", async () => {
  resetModules();
  stubPlan();
  stubModule("src/lib/prisma.ts", {
    default: {
      agentByokApiKey: {
        findUnique: async () => ({ enabled: true, ciphertext: "sk-agent" }),
      },
      teamByokApiKey: { findUnique: async () => null },
      team: {
        findUnique: async () => ({
          aiProviderSettings: { gdprSafeMode: true },
        }),
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
    encryptByokSecret: (plaintext) => plaintext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });

  const { getByokOrTeamGatewayApiKey } = loadTs(
    "src/app/api/ai/_lib/byokKeys.ts",
  );
  const { isByokProviderRestrictedInGdprSafeMode } = loadTs(
    "src/lib/aiProviders.ts",
  );

  const restricted = ["deepseek", "moonshot", "zhipu", "alibaba"].find((p) =>
    isByokProviderRestrictedInGdprSafeMode(p),
  );
  assert.ok(restricted, "expected at least one GDPR-restricted provider");

  assert.equal(
    await getByokOrTeamGatewayApiKey(restricted, [], {
      trustedTeamId: "team-1",
      userId: 6,
      agentId: "agent-1",
    }),
    undefined,
  );
});

test("agent identity reaches every AI key lookup, not just task writing", () => {
  const fs = require("./refactored-module-source.cjs");
  const editor = fs.readFileSync(
    path.join(root, "src/app/api/ai/_lib/editorAi.ts"),
    "utf8",
  );
  const stream = fs.readFileSync(
    path.join(root, "src/app/api/ai/chat/stream/route.ts"),
    "utf8",
  );

  const tiptap = editor.indexOf("export async function selectTiptapModel(");
  const selector = editor.indexOf("selectTaskWriterModel({", tiptap);
  const passedAgentId = editor.indexOf("agentId: args?.agentId ?? null", selector);
  assert.ok(passedAgentId > selector && passedAgentId < selector + 400);

  const acting = stream.indexOf("actingAgent = await loadActingAgent(");
  const stamped = stream.indexOf(
    "keyLookupContext = { ...keyLookupContext, agentId: actingAgent?.id ?? null }",
  );
  const byokLookup = stream.indexOf("getByokOrTeamGatewayApiKeyForModelOption(");
  assert.ok(acting > 0 && stamped > acting && byokLookup > stamped);
});

test("agent provider-key rejects Baseten without storing or returning the supplied key", async () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const ts = require("typescript");
  const writes = [];
  const stubs = {
    "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
    "@/lib/prisma": { default: { agent: { findFirst: async () => ({ id: "fixture-agent" }) } } },
    "@/lib/crypto/byokCipher": { encryptByokSecret: (key) => `encrypted:${key}` },
    "@/lib/crypto/maskByokSecret": { maskByokSecret: () => "masked" },
    "@/lib/aiProviders": loadTs("src/lib/aiProviders.ts"),
    "@/lib/agents/ownedSlugs": { resolveOwnedAgent: async () => ({ id: "fixture-agent" }) },
    "@/lib/auth/cookieIdentity": { verifyCookieIdentity: async () => ({ status: "verified", id: 985 }) },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 985 }) },
    "@/lib/auth/session": { SESSION_COOKIE: "fixture-session" },
    "@/lib/agents/visibility": { upsertOwnedAgentProviderKey: async (value) => { writes.push(value); return { ok: true }; } },
  };
  const filename = path.join(root, "src/app/api/agents/[agentId]/provider-key/route.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: false } }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, require: (id) => {
    assert.ok(Object.hasOwn(stubs, id), `Unexpected dependency: ${id}`);
    return stubs[id];
  }, console }, { filename });
  const request = (provider) => ({ cookies: { get: () => undefined }, headers: {}, json: async () => ({ provider, apiKey: "fake-agent-secret" }) });
  const params = { params: Promise.resolve({ agentId: "fixture-agent" }) };
  const rejected = await loadedModule.exports.PUT(request("baseten"), params);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "Unsupported provider");
  assert.equal(writes.length, 0);
  assert.ok(!JSON.stringify(rejected).includes("fake-agent-secret"));
  const allowed = await loadedModule.exports.PUT(request("openrouter"), params);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.success, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].provider, "openrouter");
});
