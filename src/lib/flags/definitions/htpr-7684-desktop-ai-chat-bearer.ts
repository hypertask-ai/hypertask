import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7684_DESKTOP_AI_CHAT_BEARER_FLAG = "htpr-7684-desktop-ai-chat-bearer";

export default {
  key: HTPR_7684_DESKTOP_AI_CHAT_BEARER_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-23",
  description: "Lets a person's desktop app CLI login send, cancel and list their own AI chats; agent, management, API-key and OAuth logins stay refused on that path.",
  releaseRisk: {
    risk: "new",
    highRisk: "access",
    reason: "Adds a validated human CLI bearer to AI chat stream, cancel and session list; cookie and OAuth access are unchanged and flag Off removes the bearer path.",
  },
} as const satisfies FeatureFlagDefinition;
