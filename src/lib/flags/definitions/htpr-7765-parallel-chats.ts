import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7765_PARALLEL_CHATS_FLAG = "htpr-7765-parallel-chats";

export default {
  key: HTPR_7765_PARALLEL_CHATS_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Runs AI chats independently, each with its own ordered queue and Stop control.",
  releaseRisk: { risk: "small", reason: "Session-scoped runtime and stream leases retain per-user request limits, existing authorization and cancellation fences." },
} as const satisfies FeatureFlagDefinition;
