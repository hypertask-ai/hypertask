import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7752_CHAT_ALERT_DIAGNOSTICS_FLAG = "htpr-7752-chat-alert-diagnostics";

export default {
  key: HTPR_7752_CHAT_ALERT_DIAGNOSTICS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "AI Chat Manager delivery failures retain the failing step and allowlisted exception metadata, without message bodies or secrets. Off restores generic reports.",
  releaseRisk: {
    risk: "small",
    reason: "Only enriches handled server-side delivery reports; recipients, permissions, message content and bounded retry behavior stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
