import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8354_SECTION_NAME_FLAG = "htpr-8354-section-name";

export default {
  key: HTPR_8354_SECTION_NAME_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description:
    "A board column now publishes its title as name beside section_title, so an agent script that reads .name maps a column to its id instead of getting null.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only adds one key to the section read and write payloads; section_title, search and every existing caller stay as they are, and Off restores today's shape.",
  },
} as const satisfies FeatureFlagDefinition;
