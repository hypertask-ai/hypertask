import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7048_CTRLJ_CHAT_LEASE_FLAG = "htpr-7048-ctrlj-chat-lease";

export default {
  key: HTPR_7048_CTRLJ_CHAT_LEASE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-09",
  description: "Keeps background native-agent replies from blocking the human AI chat opened after Ctrl+J task creation, while retaining concurrent-reply protection for each agent and the human.",
} as const satisfies FeatureFlagDefinition;
