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
}

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function stubPlan(plan = "Pro") {
  stubModule("src/app/api/ai/_lib/planGate.ts", {
    assertImageModelAllowedForPlan: async () => {},
    assertModelAllowedForPlan: async () => {},
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

test("the agent page reads and writes the key through the owner-only route", () => {
  const fs = require("node:fs");
  const route = fs.readFileSync(
    path.join(root, "src/app/api/agents/[agentId]/provider-key/route.ts"),
    "utf8",
  );
  const detail = fs.readFileSync(
    path.join(root, "src/app/agents/[agentId]/AgentDetail.tsx"),
    "utf8",
  );

  // Every handler resolves the agent through the owner's own agent list.
  assert.equal(route.match(/requireOwnedAgent\(/g).length, 4);
  assert.match(route, /resolveOwnedAgent\(userId, ref\)/);
  assert.match(route, /where: \{ id: resolved\.id, userId \}/);
  // nookies_user is client-writable, so the id is a claim. Identity has to be
  // the signed session agreeing with it, or a Better Auth session.
  assert.match(route, /verifyCookieIdentity\(/);
  assert.match(route, /identity\.status === "verified"/);
  assert.match(route, /identity\.status === "forged"/);
  assert.doesNotMatch(route, /JSON\.parse\(userCookie\.value\)/);
  // Secrets are stored encrypted and only ever returned masked.
  assert.match(route, /ciphertext: encryptByokSecret\(apiKey\)/);
  assert.doesNotMatch(route, /apiKey: decryptByokSecret/);
  assert.match(route, /maskByokSecret\(decryptByokSecret\(ciphertext\)\)/);

  assert.match(detail, /provider-key\?provider=openrouter/);
  assert.match(detail, /data-agent-provider-key/);
  assert.match(detail, /"Team key"/);
});

test("the agents list exposes only a masked key, and only to the owner", () => {
  const fs = require("node:fs");
  const listRoute = fs.readFileSync(
    path.join(root, "src/app/api/agents/route.ts"),
    "utf8",
  );

  const ownedRoute = fs.readFileSync(
    path.join(root, "src/app/api/agents/owned/route.ts"),
    "utf8",
  );
  // The register reads /api/agents/owned, so the masked tail has to come from
  // there too, through the same shared mapping, and never from a disabled row.
  assert.match(ownedRoute, /maskAgentProviderKey\(byokApiKeys\)/);
  assert.match(ownedRoute, /where: \{ enabled: true \}/);
  const shared = fs.readFileSync(
    path.join(root, "src/lib/agents/maskAgentProviderKey.ts"),
    "utf8",
  );
  assert.match(shared, /if \(row\.enabled === false\) continue;/);
  assert.match(shared, /maskByokSecret\(decryptByokSecret\(ciphertext\)\)/);
  const detail = fs.readFileSync(
    path.join(root, "src/app/agents/[agentId]/AgentDetail.tsx"),
    "utf8",
  );
  assert.match(detail, /k\.enabled !== false/);

  assert.match(listRoute, /byokApiKeys,\s*\.\.\.a\s*\}/);
  assert.match(
    listRoute,
    /providerKey:\s*\n?\s*a\.userId === currentUserId \? maskAgentProviderKey\(byokApiKeys\) : null/,
  );
  assert.match(listRoute, /maskAgentProviderKey\(byokApiKeys\)/);
  assert.doesNotMatch(listRoute, /ciphertext: row\.ciphertext,/);
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
  const fs = require("node:fs");
  const editor = fs.readFileSync(
    path.join(root, "src/app/api/ai/_lib/editorAi.ts"),
    "utf8",
  );
  const stream = fs.readFileSync(
    path.join(root, "src/app/api/ai/chat/stream/route.ts"),
    "utf8",
  );

  // Tiptap turns run as the agent too, so they must not silently bill the team.
  const tiptap = editor.indexOf("export async function selectTiptapModel(");
  const selector = editor.indexOf("selectTaskWriterModel({", tiptap);
  const passedAgentId = editor.indexOf("agentId: args?.agentId ?? null", selector);
  assert.ok(passedAgentId > selector && passedAgentId < selector + 400);

  // The chat stream resolves the acting agent before it resolves a key.
  const acting = stream.indexOf("actingAgent = await loadActingAgent(");
  const stamped = stream.indexOf(
    "keyLookupContext = { ...keyLookupContext, agentId: actingAgent?.id ?? null }",
  );
  const byokLookup = stream.indexOf("getByokOrTeamGatewayApiKeyForModelOption(");
  assert.ok(acting > 0 && stamped > acting && byokLookup > stamped);
});
