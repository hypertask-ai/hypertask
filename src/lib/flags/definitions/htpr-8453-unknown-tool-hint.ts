import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8453_UNKNOWN_TOOL_HINT_FLAG = "htpr-8453-unknown-tool-hint";

export default {
  key: HTPR_8453_UNKNOWN_TOOL_HINT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-04",
  description: "An unknown MCP tool name names the intended tool, or points at the tool search, instead of only saying to refresh the list.",
  releaseRisk: { risk: "small", reason: "Refusal text only; a valid call is untouched and the flag Off keeps today's sentence." },
} as const satisfies FeatureFlagDefinition;
