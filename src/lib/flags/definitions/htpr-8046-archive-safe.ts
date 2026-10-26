import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8046_ARCHIVE_SAFE_FLAG = "htpr-8046-archive-safe";

export default {
  key: HTPR_8046_ARCHIVE_SAFE_FLAG,
  kind: "feature",
  shippedOn: "2026-10-26",
  defaultMode: "EVERYONE",
  description: "Archive safe previews and archives pure updates in Updates, Important and Agents. Mentions, questions, assignments and human comments stay. Undo restores the batch.",
  releaseRisk: {
    risk: "small",
    reason: "Only archives notifications, never tickets or comments; reuses preview confirmation, serializable revalidation and batch undo.",
  },
} as const satisfies FeatureFlagDefinition;
