import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7338_AI_WRITER_STAYS_VISIBLE_FLAG = "htpr-7338-ai-writer-stays-visible";

export default {
  key: HTPR_7338_AI_WRITER_STAYS_VISIBLE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-18",
  description:
    "Scrolls the AI writer into view when its answer starts, so AI Description on a long ticket no longer writes above the screen while the user sees nothing happen.",
  releaseRisk: {
    risk: "small",
    reason: "Desktop only; scrolls once per answer and only when the writer is off screen, so short descriptions and the comment writer do not move.",
  },
} as const satisfies FeatureFlagDefinition;
