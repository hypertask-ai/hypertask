"use strict";

const CLIENT_PROMPT_OVERHEAD = {
  claude: 420,
  cursor: 380,
  codex: 360,
};

const TRANSPORT_TOOL_OVERHEAD = {
  mcp: 180,
  cli: 90,
};

function estimateTokens(text) {
  const chars = String(text || "").length;
  return Math.max(1, Math.ceil(chars / 4));
}

function planText(task, transport) {
  if (transport === "mcp") {
    return JSON.stringify(task.mcp.tools);
  }
  return JSON.stringify(task.cli.commands);
}

function estimateUsage(task, client, transport) {
  const promptTokens = estimateTokens(task.prompt);
  const planTokens = estimateTokens(planText(task, transport));
  const toolCalls =
    transport === "mcp" ? task.mcp.tools.length : task.cli.commands.length;
  const tokensIn =
    promptTokens +
    (CLIENT_PROMPT_OVERHEAD[client] || 0) +
    (TRANSPORT_TOOL_OVERHEAD[transport] || 0) * toolCalls;
  const tokensOut = planTokens + 24;
  return { tokensIn, tokensOut, toolCalls };
}

module.exports = {
  CLIENT_PROMPT_OVERHEAD,
  TRANSPORT_TOOL_OVERHEAD,
  estimateTokens,
  estimateUsage,
};
