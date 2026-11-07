import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7663_SCOPED_AGENT_SKILLS_FLAG = "htpr-7663-scoped-agent-skills";

export default {
  key: HTPR_7663_SCOPED_AGENT_SKILLS_FLAG,
  kind: "feature",
  shippedOn: "2026-10-24",
  defaultMode: "OWNER_AND_QA",
  description: "Lets team-bound agents discover skills across readable boards in their credential's team without specifying a project.",
  releaseRisk: {
    risk: "new",
    highRisk: "access",
    reason: "Expands unfiltered MCP and chat skill discovery; flag off refuses that expansion while scope restrictions remain unconditional.",
  },
} as const satisfies FeatureFlagDefinition;
