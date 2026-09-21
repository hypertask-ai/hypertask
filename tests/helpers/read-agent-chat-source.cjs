const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

function readAgentChatSource() {
  return [
    "useAgentLifecycle.tsx",
    "useAgentChatView.tsx",
    "AgentChatViewParts.tsx",
  ]
    .map((file) =>
      fs.readFileSync(path.join(root, "src/app/agents/chat", file), "utf8"),
    )
    .join("\n");
}

module.exports = { readAgentChatSource };
