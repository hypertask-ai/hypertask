import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7498_EXPIRED_KEY_FEEDBACK_FLAG = "htpr-7498-expired-key-feedback";

export default {
  key: HTPR_7498_EXPIRED_KEY_FEEDBACK_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "Stops automatic MCP feedback for expired or revoked bearer keys while still reporting unexpected authentication failures.",
  releaseRisk: { risk: "small", reason: "Telemetry only; authentication responses are unchanged and flag Off preserves rejected-key reporting." },
} as const satisfies FeatureFlagDefinition;
