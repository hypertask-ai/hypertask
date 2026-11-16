import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9109_SECTION_REFUSAL_STATUS_FLAG = "htpr-9109-section-refusal-status";

export default {
  key: HTPR_9109_SECTION_REFUSAL_STATUS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-16",
  description:
    "A section the caller asked for that is missing, or carries another role, is refused with a 400 and a named field instead of a bare error that reads as a server fault.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only a caller mistake on the section tool changes: it becomes a 400 refusal with its field named, so it stops filing a server error ticket. Off restores the bare error.",
  },
} as const satisfies FeatureFlagDefinition;
