import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7364_BATCH_FLAG_APPROVAL_FLAG = "htpr-7364-batch-flag-approval";

export default {
  key: HTPR_7364_BATCH_FLAG_APPROVAL_FLAG,
  kind: "improvement",
  shippedOn: "2026-10-19",
  description: "One thumbs up from Valentin on a Question comment listing several \"Switch <flag> to <mode>?\" lines approves every flag switch in it, instead of one comment and thumbs up per flag.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only changes which approval comments agents may cite when switching flags; app users see nothing."
  },
} as const satisfies FeatureFlagDefinition;
