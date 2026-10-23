import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7536_PLAIN_AI_FEEDBACK_FLAG = "htpr-7536-plain-ai-feedback";

export default {
  key: HTPR_7536_PLAIN_AI_FEEDBACK_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "Writes AI feedback in plain words and counts normal access refusals only on existing tickets.",
  releaseRisk: { risk: "small", reason: "Feedback presentation and filing only; access rules and authentication responses are unchanged. Flag Off preserves existing reports." },
} as const satisfies FeatureFlagDefinition;
