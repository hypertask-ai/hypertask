import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7910_RENAMED_FIELD_HINT_FLAG = "htpr-7910-renamed-field-hint";

export default {
  key: HTPR_7910_RENAMED_FIELD_HINT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "A refused MCP field in camelCase now names the documented snake_case field to use instead.",
  releaseRisk: {
    risk: "small",
    reason: "Only appends a 'Use project_id instead of projectId' sentence to an error the caller already gets; Off keeps today's wording.",
  },
} as const satisfies FeatureFlagDefinition;
