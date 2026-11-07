import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8904_AGENT_AUTOMATIC_AI_FLAG = "htpr-8904-agent-automatic-ai";

export default {
  key: HTPR_8904_AGENT_AUTOMATIC_AI_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-07",
  description: "Skips automatic ticket summaries, comment summaries, and smart labels for agent-authored changes. People on the same board still get those.",
  releaseRisk: {
    risk: "new",
    reason: "Stops paid automatic AI calls for agent-authored tickets, comments, and labels. Off restores those calls. Human edits keep today's summaries and labels.",
    highRisk: "money",
  },
} as const satisfies FeatureFlagDefinition;
