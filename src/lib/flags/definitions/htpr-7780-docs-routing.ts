import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7780_DOCS_ROUTING_FLAG = "htpr-7780-docs-routing";

export default {
  key: HTPR_7780_DOCS_ROUTING_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-29",
  description:
    "AI chat searches the help docs before answering product, plan, price, limit, shortcut and setup questions, and claims only what the docs state.",
  releaseRisk: {
    risk: "small",
    reason:
      "Adds one prompt block to the chat system prompt. Tool access, board tools and every existing answer path are unchanged; off restores answering from model memory.",
  },
} as const satisfies FeatureFlagDefinition;
