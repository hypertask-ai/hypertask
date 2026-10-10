import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6553_AGENT_CHAT_POLLING_FLAG = "htpr-6553-agent-chat-polling";

export default {
  key: HTPR_6553_AGENT_CHAT_POLLING_FLAG,
  shippedOn: "2026-09-17",
  description:
    "Lets a recently heartbeating agent runtime receive Agent Chat through polling when it has no webhook, and labels that chat as polling.",
} as const satisfies FeatureFlagDefinition;
