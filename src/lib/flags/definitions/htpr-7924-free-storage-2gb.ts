import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7924_FREE_STORAGE_2GB_FLAG = "htpr-7924-free-storage-2gb";

export default {
  key: HTPR_7924_FREE_STORAGE_2GB_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-26",
  description: "Refuse new uploads once a Free team has used 2 GB of attachment storage; needs htpr-7686-free-plan-limits to be on.",
  releaseRisk: {
    risk: "new",
    highRisk: "money",
    reason: "Adds a Free-plan storage cap that blocks uploads until a team upgrades; owner and QA validate the cap before wider rollout.",
  },
} as const satisfies FeatureFlagDefinition;
