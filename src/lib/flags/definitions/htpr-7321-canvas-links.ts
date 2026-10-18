import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7321_CANVAS_LINKS_FLAG = "htpr-7321-canvas-links";

export default {
  key: HTPR_7321_CANVAS_LINKS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-18",
  description:
    "Opens HTML canvas links in the app or a new tab instead of inside the page frame.",
  releaseRisk: {
    risk: "small",
    reason: "Links in HTML canvas pages open the ticket in the app or a new tab instead of inside the page frame.",
  },
} as const satisfies FeatureFlagDefinition;
