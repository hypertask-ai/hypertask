import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7758_PROGRESSIVE_CHAT_CREATE_FLAG = "htpr-7758-progressive-chat-create";

export default {
  key: HTPR_7758_PROGRESSIVE_CHAT_CREATE_FLAG,
  kind: "improvement",
  shippedOn: "2026-10-27",
  defaultMode: "EVERYONE",
  description: "Chat saves a title-only ticket immediately, then fills in the unchanged Task Writer draft without blocking its link.",
  releaseRisk: {
    risk: "small",
    reason: "Uses existing task creation and guarded updates. Failed writing keeps the saved ticket; flag off restores create-after-writing.",
  },
} as const satisfies FeatureFlagDefinition;
