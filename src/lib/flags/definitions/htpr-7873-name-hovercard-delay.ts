import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7873_NAME_HOVERCARD_DELAY_FLAG = "htpr-7873-name-hovercard-delay";

export default {
  key: HTPR_7873_NAME_HOVERCARD_DELAY_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-09",
  description:
    "The name hovercard waits 300 milliseconds before it opens on hover or keyboard focus, so moving the pointer across a page no longer flashes cards open and shut. A tap still opens it at once.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only adds a short wait before the card opens. The card content, links and closing are unchanged, and Off restores the instant open.",
  },
} as const satisfies FeatureFlagDefinition;
