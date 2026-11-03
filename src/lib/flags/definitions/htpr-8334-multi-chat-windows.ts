import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8334_MULTI_CHAT_WINDOWS_FLAG = "htpr-8334-multi-chat-windows";

export default {
  key: HTPR_8334_MULTI_CHAT_WINDOWS_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description: "Keep several AI chat windows open at once. Each window keeps its own conversation, place, size and minimised state, and Ctrl+Shift+O adds a window.",
  releaseRisk: {
    risk: "small",
    reason: "Adds extra floating chat windows beside the one that already exists; the first window, its shortcuts and every other screen keep working as they do now. Off brings back one window.",
  },
} as const satisfies FeatureFlagDefinition;
