import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8995_PICKER_AUTO_FLAG = "htpr-8995-picker-auto";

export default {
  key: HTPR_8995_PICKER_AUTO_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description: "Shows Auto first in the New Task model picker and uses that choice.",
  releaseRisk: { risk: "small", reason: "Owner and QA first because the New Task model picker changes." },
} as const satisfies FeatureFlagDefinition;
