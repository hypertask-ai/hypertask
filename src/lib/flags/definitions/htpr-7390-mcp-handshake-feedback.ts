import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7390_MCP_HANDSHAKE_FEEDBACK_FLAG = "htpr-7390-mcp-handshake-feedback";

export default {
  key: HTPR_7390_MCP_HANDSHAKE_FEEDBACK_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-20",
  description: "Stops automatic MCP unauthorized feedback for keyless OAuth discovery while still reporting rejected bearer tokens.",
  releaseRisk: { risk: "small", reason: "Telemetry only; authentication responses are unchanged and flag Off preserves keyless reporting." },
} as const satisfies FeatureFlagDefinition;
