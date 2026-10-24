import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7778_RAG_SCHEMA_FLAG = "htpr-7778-rag-schema";

export default {
  key: HTPR_7778_RAG_SCHEMA_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Serialize AI chat RAG metadata filters without unsupported propertyNames. Off restores the original provider schema.",
  releaseRisk: {
    risk: "small",
    reason: "Changes only provider-facing schema serialization while preserving input validation and retrieval behavior.",
  },
} as const satisfies FeatureFlagDefinition;
