import type { FeatureFlagDefinition } from "../definitions";

export const YPER4_910_AGENT_WRITING_FLAG = "yper4-910-agent-writing";

export default {
  key: YPER4_910_AGENT_WRITING_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-30",
  description: "Agents keep progress in the agent log: untyped agent notes stay hidden, and long or technical text is refused before it reaches a people comment. Off restores the older routing and accepts the same text again.",
  releaseRisk: {
    risk: "small",
    reason: "Only agent writes are checked. Human writes, authorization, plan limits and stored comments stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
