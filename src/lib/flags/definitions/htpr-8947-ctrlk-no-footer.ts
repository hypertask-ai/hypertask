import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8947_CTRLK_NO_FOOTER_FLAG = "htpr-8947-ctrlk-no-footer";

export default {
  key: HTPR_8947_CTRLK_NO_FOOTER_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-09",
  description:
    "Ctrl+K no longer shows the keyboard shortcut hints row or the version number at the bottom of the window. The build id stays in the page as a hidden attribute for agents.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only removes two lines of footer text from the Ctrl+K window. Search, New Task and every shortcut work the same, and Off restores the footer.",
  },
} as const satisfies FeatureFlagDefinition;
