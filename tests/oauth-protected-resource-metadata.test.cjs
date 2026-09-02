const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const originalMcpUrl = process.env.NEXT_PUBLIC_MCP_SERVER_URL;
process.env.NEXT_PUBLIC_MCP_SERVER_URL = "https://mcp.hypertask.ai/mcp";

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  cache: false,
});
const { GET } = jiti(
  path.join(root, "src/app/.well-known/oauth-protected-resource/route.ts"),
);

test.after(() => {
  if (originalMcpUrl === undefined) delete process.env.NEXT_PUBLIC_MCP_SERVER_URL;
  else process.env.NEXT_PUBLIC_MCP_SERVER_URL = originalMcpUrl;
});

test("protected-resource metadata uses the canonical MCP resource, not the request host", async () => {
  const response = GET();
  const body = await response.json();

  assert.equal(body.resource, "https://mcp.hypertask.ai/mcp");
  assert.deepEqual(body.authorization_servers, ["https://app.hypertask.ai"]);
});
