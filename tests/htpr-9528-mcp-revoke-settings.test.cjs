const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("settings MCP revoke posts without routing through window.confirm", () => {
  const controls = fs.readFileSync(
    path.join(root, "src/components/Modals/Settings/McpTokenControls.tsx"),
    "utf8",
  );
  const connections = fs.readFileSync(
    path.join(root, "src/components/Modals/McpToken/hooks/useMcpConnections.ts"),
    "utf8",
  );
  const tokenHook = fs.readFileSync(
    path.join(root, "src/components/Modals/McpToken/hooks/useMcpToken.ts"),
    "utf8",
  );

  assert.match(controls, /revokePageMcpToken/);
  assert.doesNotMatch(controls, /handleRevokeAll/);
  assert.match(controls, /void revokeToken\(\)/);
  const revokeFn = connections.match(
    /const revokePageMcpToken = async[\s\S]*?(?=\n  const handleRevokeAll)/,
  );
  assert.ok(revokeFn, "revokePageMcpToken must exist");
  assert.doesNotMatch(revokeFn[0], /confirm\(/);
  assert.match(
    tokenHook,
    /mcp_token=; path=\/; expires=Thu, 01 Jan 1970 00:00:00 GMT/,
  );
});