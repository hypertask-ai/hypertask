import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6885_SINGLE_UNDO_TOAST_FLAG = "htpr-6885-single-undo-toast";

export default {
  key: HTPR_6885_SINGLE_UNDO_TOAST_FLAG,
  shippedOn: "2026-10-03",
  description:
    "Shows one compact undo confirmation at the bottom left, replacing the previous card and fading after five seconds.",
  kind: "improvement",
} as const satisfies FeatureFlagDefinition;
