import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8135_VIEW_LABEL_ERROR_FLAG = "htpr-8135-view-label-error";

export default {
  key: HTPR_8135_VIEW_LABEL_ERROR_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-29",
  description: "Creating or editing a view with an unknown tag now names the tag and lists the board's tags, instead of failing as a server error.",
  releaseRisk: {
    risk: "small",
    reason: "Only the text and status of a refused view request change; views with known tags, filters and every other view field stay as they are.",
  },
} as const satisfies FeatureFlagDefinition;
