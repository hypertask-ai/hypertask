import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9391_TOOL_REFUSAL_CODE_FLAG = "htpr-9391-tool-refusal-code";

export default {
  key: HTPR_9391_TOOL_REFUSAL_CODE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-16",
  description:
    "A refused credential raised inside an MCP tool keeps its own error code, so the automatic feedback ticket can be read as a refused key instead of an unknown tool problem.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only the error code stored on an automatic feedback report and the hidden agent log beside the ticket. The tool still returns the same refusal to the caller. Off keeps today's tool-exception code.",
  },
} as const satisfies FeatureFlagDefinition;
