import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8951_BOARD_GITHUB_REPOS_FLAG = "htpr-8951-board-github-repos";

export default {
  key: HTPR_8951_BOARD_GITHUB_REPOS_FLAG,
  kind: "feature",
  shippedOn: "2026-11-10",
  defaultMode: "OWNER_AND_QA",
  description: "On lets agents list and set a board's connected GitHub repositories over MCP. Off keeps those agent tools unavailable.",
  releaseRisk: {
    risk: "new",
    highRisk: "access",
    reason: "Agents can change which repositories link pull requests to a board; stays at Owner and QA until an independent check passes.",
    harmEvidence: {
      harm: "private-data-exposure",
      scenario: "An agent could connect a private repository to the wrong board and expose its pull request metadata to another team.",
    },
  },
} as const satisfies FeatureFlagDefinition;
