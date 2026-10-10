import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7055_AI_SIDEBAR_DETAIL_FIT_FLAG = "htpr-7055-ai-sidebar-detail-fit";

export default {
  key: HTPR_7055_AI_SIDEBAR_DETAIL_FIT_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-10",
  description: "Keeps ticket detail values readable by stacking the properties rail when the AI sidebar leaves too little room for both columns.",
} as const satisfies FeatureFlagDefinition;
