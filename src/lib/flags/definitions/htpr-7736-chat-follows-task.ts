import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7736_CHAT_FOLLOWS_TASK_FLAG = "htpr-7736-chat-follows-task";

export default {
  key: HTPR_7736_CHAT_FOLLOWS_TASK_FLAG,
  kind: "improvement",
  shippedOn: "2026-10-26",
  defaultMode: "EVERYONE",
  description: "Keeps the selected sidebar conversation while moving between tickets, using the current ticket as context.",
  releaseRisk: { risk: "small", reason: "Retains an existing conversation; ticket access checks and explicit new-chat actions remain unchanged." },
} as const satisfies FeatureFlagDefinition;
