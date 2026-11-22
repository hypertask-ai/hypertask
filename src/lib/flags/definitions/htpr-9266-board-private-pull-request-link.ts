import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9266_BOARD_PRIVATE_PULL_REQUEST_LINK_FLAG =
  "htpr-9266-board-private-pull-request-link";

export default {
  key: HTPR_9266_BOARD_PRIVATE_PULL_REQUEST_LINK_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-22",
  description:
    "A pull request in a private repository that a board already connected through its GitHub App installation can be linked to a ticket again. The read uses a token limited to that one repository. Off keeps the old public read, which cannot see a private repository.",
  releaseRisk: {
    risk: "small",
    reason:
      "Read only, and only for a repository the ticket's own board already connected. The link stores the same pull request title and check state the board GitHub webhook already writes. Off restores the public read that cannot see a private repository.",
  },
} as const satisfies FeatureFlagDefinition;
