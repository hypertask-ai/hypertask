const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const mcpGuide = fs.readFileSync(
  path.join(root, "openwiki/integrations/mcp.md"),
  "utf8"
);
const retiredCliAgentId = "24a7c4df-6812-43ba-bf02-bc66fe550cfe";

test("the MCP guide never routes work to the retired CLI agent", () => {
  assert.doesNotMatch(mcpGuide, new RegExp(retiredCliAgentId));
});
