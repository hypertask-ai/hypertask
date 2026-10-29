import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8088_MANUAL_CHAT_FLAG = "htpr-8088-manual-chat";

export default {
  key: HTPR_8088_MANUAL_CHAT_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-29",
  description: "The AI chat opens and closes only when you do it, and keeps the same conversation while you move between tickets and boards in a team. Creating a ticket still opens it, unless you switch that off.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the existing chat sidebar and its settings; only automatic opening, closing and conversation switching change. Off restores the previous automatic behaviour.",
  },
} as const satisfies FeatureFlagDefinition;
