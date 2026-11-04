import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8536_SECTION_NOT_FILTER_FLAG = "htpr-8536-section-not-filter";

export default {
  key: HTPR_8536_SECTION_NOT_FILTER_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-04",
  description:
    "The shared list filter leaves out named columns with filter.section_not, so an agent picks free work without reading the whole board. Combining it with filter.section is refused.",
  related: ["htpr-7733-person-assignment-filter"],
  releaseRisk: {
    risk: "small",
    reason:
      "An extra filter key on the agent list and search doors that only removes rows the caller named; no caller sends it today, and with the switch off both doors answer exactly as before.",
  },
} as const satisfies FeatureFlagDefinition;
