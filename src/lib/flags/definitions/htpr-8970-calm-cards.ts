import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8970_CALM_CARDS_FLAG = "htpr-8970-calm-cards";

export default {
  key: HTPR_8970_CALM_CARDS_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description: "Board cards use the calmer polished layout: one avatar stack with a status dot for the working agent, no agent pills, routing tags hidden with at most two tags, an inbox icon instead of the In inbox pill and blue dot, a clock and day count for stale cards instead of the age line, tidier spacing and four pixel corners. Off restores today's card.",
  releaseRisk: {
    risk: "small",
    reason: "Only the look of board cards changes. Agent status and card age move to hover, routing tags stay on the ticket, and every click and shortcut stays.",
  },
} as const satisfies FeatureFlagDefinition;
