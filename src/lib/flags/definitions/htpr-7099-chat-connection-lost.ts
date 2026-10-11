import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7099_CHAT_CONNECTION_LOST_FLAG = "htpr-7099-chat-connection-lost";

export default {
  key: HTPR_7099_CHAT_CONNECTION_LOST_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-11",
  description: "Retries an AI Chat reply whose connection drops right after sending, so the answer arrives instead of 'Connection lost'.",
  releaseRisk: { risk: "small", reason: "Client-only retry of the same idempotent reply request; the server already replays a finished reply and refuses a duplicate in flight." },
} as const satisfies FeatureFlagDefinition;
