import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8038_CHAT_OPENER_READY_FLAG = "htpr-8038-chat-opener-ready";

export default {
  key: HTPR_8038_CHAT_OPENER_READY_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Keeps startup from ignoring or closing chat.",
  releaseRisk: { risk: "small", reason: "Guards existing chat buttons before hydration and treats the same board’s default-view URL as the same startup page." },
} as const satisfies FeatureFlagDefinition;
