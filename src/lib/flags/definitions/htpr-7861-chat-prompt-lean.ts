import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7861_CHAT_PROMPT_LEAN_FLAG = "htpr-7861-chat-prompt-lean";

export default {
  key: HTPR_7861_CHAT_PROMPT_LEAN_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-11",
  description: "Removes repeated chat instructions and names the tools chat can actually call.",
  releaseRisk: {
    risk: "small",
    reason: "Keeps confirmation, task scope, label safety and writing rules. Existing tool validators remain authoritative.",
  },
} as const satisfies FeatureFlagDefinition;
