import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8088_MANUAL_CHAT_FLAG = "htpr-8088-manual-chat";

export default {
  key: HTPR_8088_MANUAL_CHAT_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-27",
  description: "Keeps the sidebar open or closed as you left it and preserves its conversation across tickets and boards within a team. Off restores automatic opening and ticket-specific conversations.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses existing sidebar controls; only automatic presentation and conversation selection change.",
  },
} as const satisfies FeatureFlagDefinition;
