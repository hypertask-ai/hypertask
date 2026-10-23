const test = require("node:test");
const assert = require("node:assert/strict");
const { loader } = require("./htpr-6927-fixtures.cjs");

const originalMcpUrl = process.env.NEXT_PUBLIC_MCP_SERVER_URL;
process.env.NEXT_PUBLIC_MCP_SERVER_URL = "https://mcp.hypertask.ai/mcp";

const { GET } = loader({ "@/lib/flags": { isFeatureEnabled: async () => false } })(
  "src/app/.well-known/oauth-protected-resource/route.ts",
);

test.after(() => {
  if (originalMcpUrl === undefined) delete process.env.NEXT_PUBLIC_MCP_SERVER_URL;
  else process.env.NEXT_PUBLIC_MCP_SERVER_URL = originalMcpUrl;
});

test("protected-resource metadata uses the canonical MCP resource with the host fix off", async () => {
  const response = await GET(new Request("https://app.hypertask.ai/.well-known/oauth-protected-resource"));
  const body = await response.json();

  assert.equal(body.resource, "https://mcp.hypertask.ai/mcp");
  assert.deepEqual(body.authorization_servers, ["https://app.hypertask.ai"]);
});
