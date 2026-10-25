import type { FeatureFlagDefinition } from "../definitions";

export const AGENT_WEBHOOK_AUTH_HEADER_FLAG = "htpr-7905-agent-webhook-auth-header";

export default {
  key: AGENT_WEBHOOK_AUTH_HEADER_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-25",
  description:
    "An agent webhook can carry its own header or bearer secret, so receivers that require a key accept deliveries, tests and resends. Off stops saving and sending the header.",
  releaseRisk: {
    risk: "new",
    highRisk: "access",
    reason: "Stores a receiver credential encrypted and sends it to the saved HTTPS endpoint. It is never returned after save. Release on Valentin's go.",
  },
} as const satisfies FeatureFlagDefinition;
