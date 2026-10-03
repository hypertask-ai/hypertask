const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { read, loadTs, harness, humanMember, agentMember } = require("./helpers/board-rename.cjs");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const schemas = jiti(path.join(root, "src/lib/mcp-server/validations/project.validation.ts"));

function mcpTool(h) {
  const { BoardService } = loadTs("src/lib/mcp-server/lib/services/board.service.ts", {
    "../../config/index": {},
    "../../utils/logger": {},
    "../../utils/correlation": {},
    "../../validations/project.validation": schemas,
    "../../utils/task-link": {},
  });
  const requests = [];
  const { executeWithService } = loadTs("src/lib/mcp-server/utils/executeWithService.ts", {
    "../lib/api-client": { createApiClient: (token) => {
      assert.equal(token, "test-token");
      return { makeRequest: async (endpoint, options) => {
        requests.push({ endpoint, ...options });
        const response = await h.patch(JSON.parse(options.body).title, endpoint.split("/").at(-1));
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        return payload;
      } };
    } },
    "./serialization": { sanitizeResponse: (value) => value },
  });
  const { renameBoardTool } = loadTs("src/lib/mcp-server/tools/rename-board.tool.ts", {
    "../validations/project.validation": schemas,
    "../config/tool-metadata": { TOOL_METADATA: { RENAME_BOARD: { name: "hypertask_rename_board", description: "Rename a board" } } },
    "../utils/executeWithService": { executeWithService },
    "../lib/services/board.service": { BoardService },
  });
  return { tool: renameBoardTool, requests };
}

function aiTool(h, actingAgentId = null) {
  const statuses = [];
  const { createRenameBoardTool } = loadTs("src/lib/ai/tools/renameBoard.ts", {
    ai: { tool: (value) => value },
    "@/lib/mcp-server/validations/project.validation": schemas,
    "@/lib/auth/sessionUserRecord": h.userRecord,
    "@/utils/controllers/projects/update": h.controller,
    "@/lib/realtime/server": h.realtime,
    "./execution": { withToolErrors: (fn) => fn },
  });
  return {
    tool: createRenameBoardTool({ user: { id: 6 }, actingAgentId, sendStatus: (name) => statuses.push(name) }).hypertask_rename_board,
    statuses,
  };
}

test("rename_board is present in MCP registry, metadata and deferred catalog", () => {
  const registry = read("src/lib/mcp-server/tools/index.ts");
  assert.match(registry, /import \{ renameBoardTool \} from '\.\/rename-board\.tool'/);
  assert.match(registry, /\n  renameBoardTool,/);
  assert.match(read("src/lib/mcp-server/config/tool-metadata.ts"), /RENAME_BOARD: \{\s*name: buildToolName\('rename_board'\)/);
  assert.match(read("src/lib/mcp-server/config/tool-summaries.ts"), /RENAME_BOARD: 'Returns the renamed board\.'/);
});

test("rename_board is registered in AI chat and marked as a write with a status label", () => {
  const registry = read("src/lib/ai/tools/index.ts");
  assert.match(registry, /import \{ createRenameBoardTool \} from "\.\/renameBoard"/);
  assert.match(registry, /hypertask_rename_board: createRenameBoardTool\(context\)\.hypertask_rename_board/);
  const metadata = loadTs("src/lib/ai/tools/metadata.ts", {});
  assert.equal(metadata.toolStatus.hypertask_rename_board, "Renaming board...");
  assert.equal(metadata.writeToolNames.has("hypertask_rename_board"), true);
});

test("MCP tool sends the CLI-compatible PATCH and reaches the UI controller", async () => {
  const h = harness({ members: [humanMember()] });
  const { tool, requests } = mcpTool(h);
  const result = JSON.parse(await tool.execute({ project_id: 15, title: "  Agents & Infra  " }, "test-token"));
  assert.equal(result.success, true);
  assert.deepEqual(requests, [{ endpoint: "/mcp/projects/15", method: "PATCH", body: '{"title":"Agents & Infra"}' }]);
  assert.equal(h.board.title, "Agents & Infra");
  assert.equal(h.updates.length, 1);
});

test("MCP tool passes through the shared permission failure and never writes", async () => {
  const h = harness();
  await assert.rejects(mcpTool(h).tool.execute({ project_id: 15, title: "x" }, "test-token"), /not allowed/i);
  assert.equal(h.updates.length, 0);
});

for (const actingAgentId of [null, "agent-owned"]) {
  test(`AI chat rename calls the shared UI controller for ${actingAgentId ? "an agent" : "a human"}`, async () => {
    const h = harness({ members: actingAgentId ? [agentMember()] : [humanMember()] });
    const { tool, statuses } = aiTool(h, actingAgentId);
    const input = tool.inputSchema.parse({ project_id: 15, title: "  New board name  " });
    const result = await tool.execute(input);
    assert.equal(result.success, true);
    assert.equal(result.project.title, "New board name");
    assert.equal(h.updates.length, 1);
    assert.deepEqual(statuses, ["hypertask_rename_board"]);
    assert.deepEqual(h.broadcasts, [[15, { originUserId: 6 }]]);
  });
}

test("AI chat returns the shared readable permission denial without mutation", async () => {
  const h = harness();
  const result = await aiTool(h).tool.execute({ project_id: 15, title: "x" });
  assert.equal(result.success, false);
  assert.match(result.error, /not allowed/i);
  assert.equal(h.updates.length, 0);
});

test("MCP and AI tool inputs trim titles and reject empty or overlong titles before mutation", async () => {
  for (const title of ["", "   ", "x".repeat(201)]) {
    const h = harness({ ownerId: 6 });
    await assert.rejects(mcpTool(h).tool.execute({ project_id: 15, title }, "test-token"));
    assert.equal(aiTool(h).tool.inputSchema.safeParse({ project_id: 15, title }).success, false);
    assert.equal(h.updates.length, 0);
  }
  assert.equal(schemas.RenameBoardInputSchema.parse({ project_id: 15, title: " x " }).title, "x");
  assert.equal(schemas.RenameBoardInputSchema.safeParse({ project_id: 15, title: "x".repeat(200) }).success, true);
});
