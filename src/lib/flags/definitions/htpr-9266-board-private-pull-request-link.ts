import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9266_BOARD_PRIVATE_PULL_REQUEST_LINK_FLAG =
  "htpr-9266-board-private-pull-request-link";

export default {
  key: HTPR_9266_BOARD_PRIVATE_PULL_REQUEST_LINK_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-15",
  description:
    "A pull request in a private repository that a board already connected through its GitHub App installation can be linked to a ticket again, and its title and check state are read with that board's read-only installation token. Off keeps the old anonymous read, which cannot see private repositories.",
  releaseRisk: {
    risk: "small",
    reason:
      "Read only, and only for a repository the ticket's own board already installed the GitHub App on. The link stores the same pull request metadata the board GitHub webhook already writes for that repository. Off restores the anonymous read that fails for private repositories.",
  },
} as const satisfies FeatureFlagDefinition;
