import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7111_INBOX_SELECTED_COUNT_FLAG = "htpr-7111-inbox-selected-count";

export default {
  key: HTPR_7111_INBOX_SELECTED_COUNT_FLAG,
  kind: "feature",
  shippedOn: "2026-10-11",
  description: "Shows how many inbox messages are selected, next to the inbox header buttons, as My Tasks does.",
  releaseRisk: { risk: "small", reason: "Client-only text label in the inbox header; no data or server change." },
} as const satisfies FeatureFlagDefinition;
