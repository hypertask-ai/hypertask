const assert = require("node:assert/strict");
const test = require("node:test");
const z = require("zod");
const { load } = require("./task-route-loader.cjs");

const { executeToolResult } = load("src/lib/mcp-server/tool-response.ts", {});
const { selectMcpTools } = load("src/lib/mcp-server/consolidated-tools.ts", {});

const searchTool = (errorHints) => ({
  name: "hypertask_search_tasks",
  description: "Searches tasks",
  parameters: z.object({ project_id: z.number().optional(), query: z.string().optional() }).strict(),
  ...(errorHints ? { errorHints } : {}),
  execute: async (args) => JSON.stringify({ success: true, args }),
});

function searchCatalog(renamedFieldHint, tools = [searchTool()]) {
  return selectMcpTools(tools, true, {}, false, false, false, false, false, false, false, false, false, renamedFieldHint);
}

async function errorText(tool, args) {
  const result = await executeToolResult(tool, args, "token");
  assert.equal(result.isError, true);
  return result.content[0].text;
}

const search = (enabled) => searchCatalog(enabled).find(({ name }) => name === "hypertask_search");

for (const enabled of [true, false]) {
  test(`a camelCase field gets the documented replacement only with flag ${enabled}`, async () => {
    const text = await errorText(search(enabled), { action: "tasks", input: { projectId: 15, query: "ship" } });
    assert.equal(text, "Remove unsupported fields projectId from input; use only fields documented for this action."
      + (enabled ? " Use project_id instead of projectId." : ""));
  });
}

test("a field with no documented snake_case twin gets no wrong suggestion", async () => {
  const text = await errorText(search(true), { action: "tasks", input: { includeDescription: true } });
  assert.equal(text, "Remove unsupported fields includeDescription from input; use only fields documented for this action.");
});

test("a documented field still works through the same path", async () => {
  const result = await executeToolResult(search(true), { action: "tasks", input: { project_id: 15, query: "ship" } }, "token");
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text).data, { success: true, args: { project_id: 15, query: "ship" } });
});

test("the handler uses the authenticated user's flag to control the real error response", async () => {
  for (const enabled of [true, false]) {
    const { mcpHandler } = load("src/lib/mcp-server/handler.ts", {
      "./tools": { MCP_TOOLS: [searchTool()] },
      "./listQueryContract": { resolvePortableTools: (tools) => tools },
      "./legacy-sse": { isLegacySseRequest: () => false },
      "@/lib/telemetry/mcpSseAnalytics": { recordLegacyMcpRequest: () => {} },
      "@/lib/aiFeedback/enabled": { aiFeedbackEnabled: async () => false },
      "@/lib/aiFeedback/automatic": { observeFeedbackTools: (tools) => tools },
      "@/lib/mcp/auth": {
        extractBearerToken: (header) => header?.replace(/^Bearer /, ""),
        validateMcpAuth: async () => ({ user: { id: 985 }, agentId: null }),
      },
      "@/lib/mcp/mcpV2": { isMcpV2Enabled: async () => false },
      "@/lib/mcp/agents/scopes": { getAgentRole: async () => "write" },
      "@/lib/aiFeedback/clientInfo": { rememberFeedbackClient: () => {} },
      "@/lib/mcp/operationContext": { withMcpExecutionContext: (_token, _ctx, run) => run() },
      "@/lib/flags": {
        HTPR_6804_MCP_TOOLS_FLAG: "catalog",
        isFeatureEnabled: async (key, userId) => {
          assert.equal(userId, 985);
          return key === "catalog" || (key === "htpr-7910-renamed-field-hint" && enabled);
        },
      },
    });
    const response = await mcpHandler(new Request("https://mcp.example.com/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer fixture-token", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
        name: "hypertask_search", arguments: { action: "tasks", input: { projectId: 15 } },
      } }),
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.isError, true);
    assert.equal(body.result.content[0].text, "Remove unsupported fields projectId from input; use only fields documented for this action."
      + (enabled ? " Use project_id instead of projectId." : ""));
  }
});

const consolidatedTool = (documentedFields) => ({
  name: "hypertask_search",
  description: "Searches tasks",
  parameters: z.object({ action: z.string(), input: z.object({}).passthrough().optional() }).strict(),
  errorHints: { renamedField: true },
  execute: async () => {
    throw Object.assign(
      new z.ZodError([{ code: "unrecognized_keys", keys: ["projectId"], path: ["input"], message: "Unrecognized key: projectId" }]),
      documentedFields ? { documentedFields } : {},
    );
  },
});

test("the action's own documented fields drive the suggestion, not the wrapper's", async () => {
  const text = await errorText(consolidatedTool(["project_id", "query"]), { action: "search", input: { projectId: 15 } });
  assert.match(text, /Remove unsupported fields projectId from input/);
  assert.match(text, /Use project_id instead of projectId\./);
});

test("without the action's field list nothing is guessed", async () => {
  const text = await errorText(consolidatedTool(undefined), { action: "search", input: { projectId: 15 } });
  assert.equal(text, "Remove unsupported fields projectId from input; use only fields documented for this action.");
});

test("standalone tools use their own documented fields", async () => {
  const text = await errorText(searchTool({ renamedField: true }), { projectId: 15 });
  assert.equal(text, "Remove unsupported fields projectId from input; use only fields documented for this action. Use project_id instead of projectId.");
});

test("the hint names the public field even when its legacy implementation uses camelCase", async () => {
  const tools = searchCatalog(true, [{
    name: "hypertask_get_view",
    description: "Get a view",
    parameters: z.object({ viewId: z.number() }).strict(),
    execute: async (args) => JSON.stringify({ success: true, args }),
  }]);
  const view = tools.find(({ name }) => name === "hypertask_views");
  const text = await errorText(view, { action: "get", input: { viewId: 1, viewID: 1 } });
  assert.equal(text, "Remove unsupported fields viewID from input; use only fields documented for this action. Use view_id instead of viewID.");
});

test("a nested unknown field is not confused with an action's top-level field", async () => {
  const tools = searchCatalog(true, [{
    ...searchTool(),
    parameters: z.object({ project_id: z.number().optional(), filter: z.object({ query: z.string().optional() }).strict() }).strict(),
  }]);
  const tool = tools.find(({ name }) => name === "hypertask_search");
  const text = await errorText(tool, { action: "tasks", input: { filter: { projectId: 15 } } });
  assert.equal(text, "Remove unsupported fields projectId from input.filter; use only fields documented for this action.");
});

test("a camelCase field next to action, outside input, still names the documented field", async () => {
  const tools = searchCatalog(true, [{
    name: "hypertask_section",
    description: "Sections",
    parameters: z.object({ action: z.enum(["list"]), project_id: z.number().optional() }).strict(),
    execute: async (args) => JSON.stringify({ success: true, args }),
  }]);
  const sections = tools.find(({ name }) => name === "hypertask_sections");
  const text = await errorText(sections, { action: "list", projectId: 15 });
  assert.equal(text, "Remove unsupported fields projectId from input; use only fields documented for this action. Use project_id instead of projectId.");
});
