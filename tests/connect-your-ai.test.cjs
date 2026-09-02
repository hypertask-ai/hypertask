const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  cache: false,
});
const {
  CONNECT_PROVIDER_STEPS,
  getOtherChatsCopy,
} = jiti(path.join(root, "src/components/Modals/Settings/connectYourAi.ts"));

const serverUrl = "https://mcp.hypertask.ai/mcp";

test("Connect-your-AI setup keeps both provider journeys to three steps", () => {
  assert.equal(CONNECT_PROVIDER_STEPS.claude.length, 3);
  assert.equal(CONNECT_PROVIDER_STEPS.chatgpt.length, 3);
  assert.match(CONNECT_PROVIDER_STEPS.claude[1], /Connectors/);
  assert.match(CONNECT_PROVIDER_STEPS.chatgpt[1], /Apps and Connectors/);
});

test("the fallback chat sentence contains the canonical MCP server URL", () => {
  assert.equal(
    getOtherChatsCopy(serverUrl),
    "Connect to Hypertask at https://mcp.hypertask.ai/mcp.",
  );
});
