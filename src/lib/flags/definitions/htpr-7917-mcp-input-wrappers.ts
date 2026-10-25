import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7917_MCP_INPUT_WRAPPERS_FLAG = "htpr-7917-mcp-input-wrappers";

export default {
  key: HTPR_7917_MCP_INPUT_WRAPPERS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "Lets MCP tool calls put response_format, limit, offset or page inside input, where they are moved to the call level instead of being refused.",
  releaseRisk: { risk: "small", reason: "Input compatibility only; flag Off keeps today's refusal, and a field the action documents inside input stays where the caller put it." },
} as const satisfies FeatureFlagDefinition;
