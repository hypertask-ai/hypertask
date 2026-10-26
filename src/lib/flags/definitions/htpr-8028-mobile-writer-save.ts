import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8028_MOBILE_WRITER_SAVE_FLAG = "htpr-8028-mobile-writer-save";

export default {
  key: HTPR_8028_MOBILE_WRITER_SAVE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Keeps mobile task dictation in the existing phone writer and saves the original draft if writing fails.",
  releaseRisk: { risk: "small", reason: "Mobile create uses its existing writer and guarded save; desktop and flag-off behavior stay unchanged." },
} as const satisfies FeatureFlagDefinition;
