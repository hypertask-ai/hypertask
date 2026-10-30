import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8044_TRIAGE_INBOX_FLAG = "htpr-8044-triage-inbox";

export default {
  key: HTPR_8044_TRIAGE_INBOX_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Ctrl+K Triage inbox opens AI chat with whole-inbox review, one exact batch approval and undo instructions. Requires safe inbox batch tools.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses existing commands, chat and reversible inbox archives. Hidden unless safe batch tools are enabled; Off removes only this shortcut.",
  },
} as const satisfies FeatureFlagDefinition;
