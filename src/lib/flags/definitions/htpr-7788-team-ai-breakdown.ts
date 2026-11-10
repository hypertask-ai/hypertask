import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7788_TEAM_AI_BREAKDOWN_FLAG = "htpr-7788-team-ai-breakdown";

export default {
  key: HTPR_7788_TEAM_AI_BREAKDOWN_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description:
    "Settings AI usage lists every team the viewer owns with that team's full breakdown by model, feature, board and member.",
  releaseRisk: {
    risk: "small",
    reason:
      "Repeats the AI usage figures a team owner can already open on two settings pages, one card per owned team. Board admins keep their board-scoped card, member rows stay owner-only, and Off restores today's single-team page.",
  },
} as const satisfies FeatureFlagDefinition;
