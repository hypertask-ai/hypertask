import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7897_MCP_INPUT_FIELDS_FLAG = "htpr-7897-mcp-input-fields";

export default {
  key: HTPR_7897_MCP_INPUT_FIELDS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "Lets MCP tool calls pass an action's documented fields at the top level of the arguments, not only inside input.",
  releaseRisk: { risk: "small", reason: "Input compatibility only; flag Off keeps today's refusal, and calls that already work reach the same tool arguments." },
} as const satisfies FeatureFlagDefinition;
