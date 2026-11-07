import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8811_AGENT_NOTE_IMAGE_LINKS_FLAG = "htpr-8811-agent-note-image-links";

export default {
  key: HTPR_8811_AGENT_NOTE_IMAGE_LINKS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-06",
  description: "Stores a plain agent note that only contains image links in the agent log. Off asks for a people kind again before that note is saved.",
  releaseRisk: {
    risk: "small",
    reason: "Only image links written in the note text skip the attachment kind check. Uploaded files and attachment flags still require a people kind.",
  },
} as const satisfies FeatureFlagDefinition;
