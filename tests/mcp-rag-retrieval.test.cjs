const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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

test("chat and MCP import the shared board-knowledge retrieval", () => {
  const chatSource = fs.readFileSync(
    path.join(root, "src/app/api/ai/chat/stream/route.ts"),
    "utf8",
  );
  const serviceSource = fs.readFileSync(
    path.join(
      root,
      "src/lib/mcp-server/lib/services/rag-retrieval.service.ts",
    ),
    "utf8",
  );
  const sharedSource = fs.readFileSync(
    path.join(root, "src/lib/rag/retrieveBoardKnowledge.ts"),
    "utf8",
  );

  assert.match(
    chatSource,
    /from "@\/lib\/rag\/retrieveBoardKnowledge"/,
  );
  assert.match(
    serviceSource,
    /from '@\/lib\/rag\/retrieveBoardKnowledge'/,
  );
  assert.match(serviceSource, /agentId: ctx\.agentId/);
  assert.match(
    sharedSource,
    /getProjectWhere\(principal\.userId, principal\.agentId\)/,
  );
});
