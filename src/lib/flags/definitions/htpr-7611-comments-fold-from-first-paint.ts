import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7611_COMMENTS_FOLD_FROM_FIRST_PAINT_FLAG = "htpr-7611-comments-fold-from-first-paint";

export default {
  key: HTPR_7611_COMMENTS_FOLD_FROM_FIRST_PAINT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description: "Uses the folded-comments setting the page already loaded until the settings request returns, so folded comments stay folded from the first paint instead of opening wide and folding again.",
  related: ["htpr-7611-comment-parts-one-pass"],
  releaseRisk: {
    risk: "small",
    reason: "Only changes which copy of the same folded-comments setting is read in the first moments after a ticket opens. Off restores reading the settings default first.",
  },
} as const satisfies FeatureFlagDefinition;
