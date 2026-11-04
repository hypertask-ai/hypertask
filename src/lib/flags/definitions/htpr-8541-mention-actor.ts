import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8541_MENTION_ACTOR_FLAG = "htpr-8541-mention-actor";

export default {
  key: HTPR_8541_MENTION_ACTOR_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-04",
  description:
    "A mention notification names the agent that wrote the comment instead of the agent's owner, in the digest line, the push title and the recorded author.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only changes the name shown for a mention an agent wrote. With the switch off the owner's name is used exactly as today, and a mention written by a person is unchanged either way.",
  },
} as const satisfies FeatureFlagDefinition;
