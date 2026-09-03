const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const managementTools = [
  "list_agents",
  "create_agent",
  "revoke_agent",
  "mint_token",
  "revoke_token",
  "list_connections",
];

test("management operations are registered in MCP and AI Chat", () => {
  const metadata = read("src/lib/mcp-server/config/tool-metadata.ts");
  const registry = read("src/lib/mcp-server/tools/index.ts");
  const aiChat = read("src/app/api/ai/chat/stream/route.ts");

  for (const name of managementTools) {
    assert.match(metadata, new RegExp(`buildToolName\\(["']${name}["']\\)`));
    assert.match(aiChat, new RegExp(`hypertask_${name}: tool\\(`));
  }
  for (const variable of [
    "listAgentsTool",
    "createAgentTool",
    "revokeAgentTool",
    "mintTokenTool",
    "revokeTokenTool",
    "listConnectionsTool",
  ]) {
    assert.match(registry, new RegExp(`\\b${variable},`));
  }
});

test("management-only keys can authenticate the MCP transport without gaining data scope", () => {
  const handler = read("src/lib/mcp-server/handler.ts");
  const auth = read("src/lib/mcp/auth.ts");

  assert.match(handler, /const ctx = await validateMcpAuth\(request,/);
  assert.match(handler, /if \(ctx\.management\)/);
  assert.match(
    handler,
    /hasAnyManagementPermission\(ctx\.management\.permissions\)/,
  );
  assert.match(handler, /scopes: \[["']mcp:management["']\]/);
  assert.doesNotMatch(handler, /jwt\.verify/);
  assert.match(handler, /scopes: \[["']mcp:full["']\],\s+expiresAt,/);
  assert.match(auth, /export const isManagementKeyToken/);
  assert.match(auth, /isManagementKeyToken\(token\)/);
  assert.match(auth, /!hasDataPermission/);
  assert.match(auth, /scopedTokenRevocationJti\(userId/);
  assert.match(auth, /tokenRevocationJtis\(user\.id, token/);
  assert.match(auth, /user_id: user\.id/);
  assert.match(auth, /MCP_TOKEN_ISSUED_AT_MS_CLAIM/);
  assert.match(auth, /typeof issuedAtMs === ['"]number['"]/);
  assert.match(auth, /request\.headers\.has\(['"]Authorization['"]\)/);
});

test("admin routes expose agents, tokens, rotation, and connection inventory", () => {
  const routes = {
    "src/app/api/mcp/admin/agents/route.ts": ["GET", "POST", "DELETE"],
    "src/app/api/mcp/admin/agents/[agentId]/token/route.ts": ["POST"],
    "src/app/api/mcp/agents/[agentId]/route.ts": ["DELETE", "PATCH"],
    "src/app/api/mcp/admin/tokens/route.ts": ["POST", "DELETE"],
    "src/app/api/mcp/admin/connections/route.ts": ["GET"],
  };

  for (const [route, methods] of Object.entries(routes)) {
    const source = read(route);
    for (const method of methods) {
      assert.match(source, new RegExp(`\\b${method}\\b`));
    }
  }

  const agents = read("src/app/api/mcp/admin/agents/route.ts");
  const rotation = read(
    "src/app/api/mcp/admin/agents/[agentId]/token/route.ts",
  );
  const tokens = read("src/app/api/mcp/admin/tokens/route.ts");
  const accountTokens = read("src/lib/mcp/accountTokens.ts");
  const connections = read("src/app/api/mcp/admin/connections/route.ts");
  for (const handler of [
    "handleListAgentsRequest",
    "handleCreateAgentRequest",
    "handleRevokeAgentRequest",
  ]) {
    assert.match(
      agents,
      new RegExp(`${handler}\\(request, ["']management["']\\)`),
    );
  }
  assert.match(rotation, /request,\s*agentId,\s*["']management["']/);
  assert.match(tokens, /validateManagementOrSessionAuth\(request, ["']write["']\)/);
  assert.match(tokens, /revokeAccountMcpToken/);
  assert.match(accountTokens, /revokeOwnedTokenByJti/);
  assert.doesNotMatch(accountTokens, /mcpTokensRevokedAt:\s*null/);
  assert.match(connections, /validateManagementOrSessionAuth\(request, ["']read["']\)/);
  assert.match(
    read("src/lib/mcp/agents/create.ts"),
    /validateManagementOrSessionAuth\(request, ['"]write['"]\)/,
  );
  assert.match(
    read("src/lib/mcp/agents/list.ts"),
    /validateManagementOrSessionAuth\(request, ['"]read['"]\)/,
  );
  assert.match(
    read("src/lib/mcp/agents/revoke.ts"),
    /validateManagementOrSessionAuth\(request, ['"]write['"]\)/,
  );
  assert.match(
    read("src/lib/mcp/agents/rotateToken.ts"),
    /validateManagementOrSessionAuth\(request, ['"]write['"]\)/,
  );
});

test("credential writes require cross-message confirmation in AI Chat", () => {
  const aiChat = read("src/app/api/ai/chat/stream/route.ts");
  assert.match(aiChat, /requireAccountManagementConfirmation/);
  for (const operation of [
    "create-agent",
    "revoke-agent",
    "mint-token",
    "revoke-token",
  ]) {
    assert.match(aiChat, new RegExp(`"${operation}"`));
  }
  assert.match(aiChat, /if \(actingAgentId\)/);
});

test("native agents cannot inherit human account-management tools in HyperAI", () => {
  const adapter = read("src/app/api/ai/_lib/hyperAiTools.ts");
  const route = read("src/app/api/ai/hyper-mentioned/route.ts");

  for (const metadataKey of [
    "LIST_AGENTS",
    "CREATE_AGENT",
    "REVOKE_AGENT",
    "MINT_TOKEN",
    "REVOKE_TOKEN",
    "LIST_CONNECTIONS",
  ]) {
    assert.match(adapter, new RegExp(`TOOL_METADATA\\.${metadataKey}\\.name`));
  }
  assert.match(adapter, /actingAgentId &&/);
  assert.match(adapter, /ACCOUNT_MANAGEMENT_TOOLS\.has\(mcpTool\.name\)/);
  assert.match(route, /actingAgentId: bearerContext\?\.agentId \?\? null/);
  assert.match(route, /const requestUser = hasAuthorization/);
});
