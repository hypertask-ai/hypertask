import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8018_PROJECT_PAGE_SIZE_FLAG = "htpr-8018-project-page-size";

export default {
  key: HTPR_8018_PROJECT_PAGE_SIZE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Invalid project-list page sizes use the normal default instead of causing a server error.",
  releaseRisk: {
    risk: "small",
    reason: "Only invalid page-size fallback changes. Valid pagination and existing board access stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
