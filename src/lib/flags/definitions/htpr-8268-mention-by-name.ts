import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8268_MENTION_BY_NAME_FLAG = "htpr-8268-mention-by-name";

export default {
  key: HTPR_8268_MENTION_BY_NAME_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description:
    "An agent names a person in a comment instead of a user number. A name or user id is resolved against the board members, and an unknown or unclear name is refused with close matches.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only widens the mention input for agents. A refused name saves nothing, and the existing { user_id, display_name } form behaves the same with the switch off.",
  },
} as const satisfies FeatureFlagDefinition;
