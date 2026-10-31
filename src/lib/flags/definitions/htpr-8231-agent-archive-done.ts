import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8231_AGENT_ARCHIVE_DONE_FLAG = "htpr-8231-agent-archive-done";

export default {
  key: HTPR_8231_AGENT_ARCHIVE_DONE_FLAG,
  kind: "improvement",
  shippedOn: "2026-10-31",
  defaultMode: "OWNER_AND_QA",
  description: "An owner's own agents may archive finished tickets in Done columns; deleting them stays refused.",
  releaseRisk: {
    risk: "new",
    highRisk: "access",
    reason: "Changes who may archive finished tickets. Only the ticket owner's own agents gain archiving, archives stay reversible, and agents still cannot delete.",
  },
} as const satisfies FeatureFlagDefinition;
