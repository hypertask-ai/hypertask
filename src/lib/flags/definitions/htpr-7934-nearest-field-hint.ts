import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7934_NEAREST_FIELD_HINT_FLAG = "htpr-7934-nearest-field-hint";

export default {
  key: HTPR_7934_NEAREST_FIELD_HINT_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-25",
  description: "Suggests the nearest real input field when an MCP caller sends an unknown one.",
  releaseRisk: { risk: "small", reason: "Refusal text only; flag Off keeps today's sentence, and a valid call is untouched." },
} as const satisfies FeatureFlagDefinition;
