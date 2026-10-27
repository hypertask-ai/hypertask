import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8014_COMPOSE_BOARD_ORDER_FLAG = "htpr-8014-compose-board-order";

export default {
  key: HTPR_8014_COMPOSE_BOARD_ORDER_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-27",
  description: "Ctrl+J's board picker puts recently used boards first, with equal usage sorted alphabetically.",
  releaseRisk: {
    risk: "small",
    reason: "Reorders the existing New Task board picker using saved navigation history; task moves and board permissions stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
