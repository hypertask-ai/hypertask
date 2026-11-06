import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7751_OWN_KEY_REJECTED_FLAG = "htpr-7751-own-key-rejected";

export default {
  key: HTPR_7751_OWN_KEY_REJECTED_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-06",
  description:
    "Chat names which of your own AI keys a provider rejected, and tells you to update it in Settings.",
  releaseRisk: {
    risk: "small",
    reason: "Changes only the chat error text for a rejected own key. Routing, keys, and DeepSeek's existing refusal stay as they are.",
  },
} as const satisfies FeatureFlagDefinition;
