import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8251_DESCRIPTION_AI_EDIT_FLAG = "htpr-8251-description-ai-edit";

export default {
  key: HTPR_8251_DESCRIPTION_AI_EDIT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description:
    "The description's AI edit opens the same inline modal as comments through the shared ai control, instead of the Edit with AI button opening the old Write with AI panel.",
  related: ["htpr-8173-description-inline-drafts", "htpr-7393-comment-inline-ai"],
  releaseRisk: {
    risk: "small",
    reason:
      "Only the description's own AI entry changes; comment routing, saving and every other editor keep their current path, and Off restores the old button and panel.",
  },
} as const satisfies FeatureFlagDefinition;
