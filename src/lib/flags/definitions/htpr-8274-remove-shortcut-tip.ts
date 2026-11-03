import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8274_REMOVE_SHORTCUT_TIP_FLAG = "htpr-8274-remove-shortcut-tip";

export default {
  key: HTPR_8274_REMOVE_SHORTCUT_TIP_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description: "Stops the keyboard shortcut tip that appeared after three mouse archives in the inbox. On for everyone; Off brings the tip back for Owner and QA only.",
  releaseRisk: {
    risk: "small",
    reason: "Hides one tip banner that only Owner and QA could see. Inbox archiving by mouse and by E, the undo toast and the bottom quick-tips bar are unchanged; Off restores the tip exactly as it is today.",
  },
} as const satisfies FeatureFlagDefinition;
