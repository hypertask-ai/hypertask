import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8964_REMOVE_PERSON_HOVER_FLAG = "htpr-8964-remove-person-hover";

export default {
  key: HTPR_8964_REMOVE_PERSON_HOVER_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description: "Stop hovering over a name or an agent from opening a person card.",
  releaseRisk: {
    risk: "small",
    reason: "Only stops the hover reveal on names and agents. Off restores the person card on hover.",
  },
} as const satisfies FeatureFlagDefinition;
