import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6962_KEEP_ASSIGNEE_FLAG = "htpr-6962-keep-assignee";

export default {
  key: HTPR_6962_KEEP_ASSIGNEE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-06",
  description: "Keeps a newly selected assignee visible after closing the picker when an older task refresh finishes.",
} as const satisfies FeatureFlagDefinition;
