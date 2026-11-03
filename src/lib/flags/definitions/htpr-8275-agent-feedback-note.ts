import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8275_AGENT_FEEDBACK_NOTE_FLAG = "htpr-8275-agent-feedback-note";

export default {
  key: HTPR_8275_AGENT_FEEDBACK_NOTE_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description: "Our own team's agents keep a kind and a cleaned short note on the feedback ticket they file; customer agents keep today's report with free text dropped.",
  related: ["htpr-7536-plain-ai-feedback", "htpr-7195-ai-feedback"],
  releaseRisk: { risk: "new", reason: "Feedback tickets filed by our own agents gain a kind and a scrubbed note; customer reports, access rules and ticket destinations are unchanged, and flag Off restores today's tickets." },
} as const satisfies FeatureFlagDefinition;
