const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

function readAgentDetailSource() {
  return [
    "agentDetailTypes.ts",
    "AgentDetailParts.tsx",
    "useAgentDetailState.ts",
    "useAgentDetailRefresh.ts",
    "useAgentDetailSubscriptions.ts",
    "useAgentProviderKey.ts",
    "useAgentDetailLifecycle.ts",
    "useAgentConfig.ts",
    "useAgentBoardAccess.ts",
    "AgentDetailHeader.tsx",
    "AgentRunHistory.tsx",
    "AgentInstructions.tsx",
    "AgentConfigForm.tsx",
    "AgentBoardAccess.tsx",
    "AgentDetailView.tsx",
    "AgentDetail.tsx",
  ].map((file) => fs.readFileSync(path.join(root, "src/app/agents/[agentId]", file), "utf8")).join("\n");
}

module.exports = { readAgentDetailSource };
