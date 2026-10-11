import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6971_CHAT_HISTORY_PAGING_FLAG = "htpr-6971-chat-history-paging";

export default {
  key: HTPR_6971_CHAT_HISTORY_PAGING_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-11",
  description: "Loads AI chat history thirty titles at a time and fetches messages only for the conversation you open.",
  releaseRisk: { risk: "new", reason: "Changes session loading and selection; legacy behavior remains available when disabled or server paging is unavailable." },
} as const satisfies FeatureFlagDefinition;
