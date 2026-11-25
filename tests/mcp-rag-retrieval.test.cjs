require("./helpers/register-server-only.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/mcp-rag-retrieval-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  },
);

const { RagRetrievalInputSchema } = jiti(
  path.join(
    root,
    "src/lib/mcp-server/validations/rag-retrieval.validation.ts",
  ),
);
const { MCP_TOOLS } = jiti(
  path.join(root, "src/lib/mcp-server/tools/index.ts"),
);

test("rag_retrieval schema requires a query", () => {
  assert.equal(RagRetrievalInputSchema.safeParse({}).success, false);
  assert.deepEqual(
    RagRetrievalInputSchema.parse({ query: "customer authentication problem" }),
    {
      query: "customer authentication problem",
      limit: 10,
    },
  );
});

test("rag_retrieval is registered in MCP_TOOLS", () => {
  assert.ok(
    MCP_TOOLS.some((tool) => tool.name === "hypertask_rag_retrieval"),
  );
});

function serviceFor(f) {
  const { RagRetrievalService } = f.load('src/lib/mcp-server/lib/services/rag-retrieval.service.ts', {
    '@/lib/mcp/operationContext': { getMcpExecutionContext: () => undefined },
    '@/lib/mcp/auth': { validateMcpAuth: async () => { await f.scope.prepareAgentScope(f.user.id, f.agent.id); return f.state.ctx; } },
    '@/utils/controllers/turbopuffer/turbopufferHelper': {
      searchTasks: async ({ projectIds }) => f.tasks.filter(task => projectIds.includes(task.projectId)),
      searchComments: async () => [],
    },
  });
  return new RagRetrievalService({});
}

for (const mode of ['WATCH', 'ENFORCE']) {
  test(`RAG service establishes request scope before auth and refuses an agent with boards in ${mode}`, async () => {
    const { fixture } = require('./helpers/agent-board-scope.cjs');
    const f = fixture();
    f.state.enforce = mode === 'ENFORCE';
    const body = await serviceFor(f).ragRetrieval({ query: 'private query', project_id: 2128 }, 'test-bearer');
    assert.equal(body.success, false);
    assert.equal(f.state.flagReads, 1);
    assert.equal(f.state.grantReads, mode === 'WATCH' ? 1 : 0);
    assert.equal(f.state.events.length, 0);
  });
}

test('RAG service keeps owner access for a zero-board agent in WATCH', async () => {
  const { fixture } = require('./helpers/agent-board-scope.cjs');
  const f = fixture();
  f.state.enforce = false;
  f.projects.forEach(project => { project.members = []; });
  const body = await serviceFor(f).ragRetrieval({ query: 'owner query', project_id: 2128 }, 'test-bearer');
  assert.equal(body.success, true);
  assert.deepEqual(body.documents.map(document => document.projectId), [2128]);
  assert.deepEqual(f.state.events[0].properties, { agentId: f.agent.id, ownerUserId: f.user.id, projectId: 2128, route: '/api/mcp/rag-retrieval', action: 'read', zeroBoard: true });
});
