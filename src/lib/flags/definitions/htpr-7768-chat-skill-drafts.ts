import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7768_CHAT_SKILL_DRAFTS_FLAG = "htpr-7768-chat-skill-drafts";

export default {
  key: HTPR_7768_CHAT_SKILL_DRAFTS_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Shows reusable skill drafts in AI chat and requires approval before saving or updating them.",
  releaseRisk: {
    risk: "small",
    reason: "Uses existing skill permissions and storage; Off restores direct chat skill writes.",
  },
} as const satisfies FeatureFlagDefinition;
