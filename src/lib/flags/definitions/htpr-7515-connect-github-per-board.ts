import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG = "htpr-7515-connect-github-per-board";

export default {
  key: HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG,
  kind: "feature",
  shippedOn: "2026-10-21",
  defaultMode: "OWNER_AND_QA",
  description: "On lets the owner connect a team's GitHub App installation and choose repositories for a board. Off keeps existing GitHub pull request routing unchanged.",
  releaseRisk: {
    risk: "new",
    highRisk: "access",
    reason: "Grants GitHub repository access and binds it to team boards; stays at Owner and QA until independent QA passes.",
  },
} as const satisfies FeatureFlagDefinition;
