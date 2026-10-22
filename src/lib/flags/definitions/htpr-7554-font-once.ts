import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7554_FONT_ONCE_FLAG = "htpr-7554-font-once";

export default {
  key: HTPR_7554_FONT_ONCE_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "Font preloads use the same deployment URL as the stylesheet, so the browser can reuse the download instead of fetching the font twice.",
  releaseRisk: {
    risk: "small",
    reason: "Only the preload URL changes; font files, styles and preload eligibility stay the same. Off restores the previous URLs.",
  },
} as const satisfies FeatureFlagDefinition;
