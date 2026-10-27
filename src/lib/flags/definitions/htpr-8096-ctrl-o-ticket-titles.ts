import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8096_CTRL_O_TICKET_TITLES_FLAG = "htpr-8096-ctrl-o-ticket-titles";

export default {
  key: HTPR_8096_CTRL_O_TICKET_TITLES_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-27",
  defaultMode: "EVERYONE",
  description: "Shows ticket IDs and current titles instead of bare ticket URLs in Ctrl+O, with ID-only fallback when unavailable.",
  releaseRisk: {
    risk: "small",
    reason: "Enriches existing link labels using the current user's board read access; link destinations and other links stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
