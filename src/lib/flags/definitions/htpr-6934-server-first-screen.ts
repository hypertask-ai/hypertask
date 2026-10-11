import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6934_SERVER_FIRST_SCREEN_FLAG = "htpr-6934-server-first-screen";

export default {
  key: HTPR_6934_SERVER_FIRST_SCREEN_FLAG,
  shippedOn: "2026-10-04",
  description: "Prepares a shared board and inbox first-render contract. Server payloads are not enabled by this step.",
  kind: "improvement",
  releaseRisk: {
    "risk": "none",
    "reason": "Loads the existing board and inbox from server data without adding interface controls."
  },
} as const satisfies FeatureFlagDefinition;
