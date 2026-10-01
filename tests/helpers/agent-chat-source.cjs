const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

function readAgentChatSource() {
  return [
    "agentChatTypes.ts",
    "AgentChatFeedItems.tsx",
    "useAgentChatState.ts",
    "useAgentChatRoster.ts",
    "useAgentChatSession.ts",
    "useAgentChatFeed.ts",
    "useAgentChatStream.ts",
    "useAgentChatNavigation.ts",
    "useAgentChatSend.ts",
    "useAgentChatComposer.ts",
    "useAgentLifecycle.ts",
    "AgentChatRosterPane.tsx",
    "AgentChatPane.tsx",
    "useAgentChatDetailsSheet.ts",
    "AgentChatView.tsx",
    "AgentChatCreateModal.tsx",
    "AgentChatClient.tsx",
  ].map((file) => fs.readFileSync(path.join(root, "src/app/agents/chat", file), "utf8")).join("\n");
}

module.exports = { readAgentChatSource };
