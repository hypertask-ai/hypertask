import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7843_SECTIONS_ROLE_FLAG = "htpr-7843-sections-role";

export default {
  key: HTPR_7843_SECTIONS_ROLE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "Board columns answer to the semantic role the manifest publishes: role filters a list, checks a get, and writes explain that it follows the title.",
  releaseRisk: {
    risk: "small",
    reason: "Adds one optional input field and one response field on the sections tool. Off ignores role, so list and get return exactly what they return today.",
  },
} as const satisfies FeatureFlagDefinition;
