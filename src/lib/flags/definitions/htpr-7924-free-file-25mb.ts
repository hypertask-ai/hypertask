import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7924_FREE_FILE_25MB_FLAG = "htpr-7924-free-file-25mb";

export default {
  key: HTPR_7924_FREE_FILE_25MB_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-26",
  description: "Raise the Free plan per-file attachment limit from 10 MB to 25 MB; needs htpr-7686-free-plan-limits to be on.",
  releaseRisk: {
    risk: "new",
    highRisk: "money",
    reason: "Changes a Free-plan limit that decides when teams are asked to upgrade; owner and QA validate the 25 MB boundary before wider rollout.",
  },
} as const satisfies FeatureFlagDefinition;
