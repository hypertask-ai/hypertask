import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7767_SESSION_MESSAGE_QUEUE_FLAG = "htpr-7767-session-message-queue";

export default {
  key: HTPR_7767_SESSION_MESSAGE_QUEUE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Keeps each AI chat's queued messages across chat switching and reloads without sending them to another chat.",
  releaseRisk: { risk: "small", reason: "Client-side session-keyed queue persistence and draining; reuses the existing composer and authenticated chat stream." },
} as const satisfies FeatureFlagDefinition;
