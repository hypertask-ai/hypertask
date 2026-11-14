import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9013_RAG_COMMENTS_FLAG = "htpr-9013-rag-comments";

export default {
  key: HTPR_9013_RAG_COMMENTS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-11",
  description:
    "AI chat keeps the best matching comments and includes them alongside matching tickets in its answer context.",
  releaseRisk: {
    risk: "small",
    reason:
      "Changes retrieval order only, after existing access and metadata checks. No new AI calls, stored data or UI. Off restores date-ranked comments and ticket-first context.",
  },
} as const satisfies FeatureFlagDefinition;
