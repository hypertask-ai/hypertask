import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8024_PROJECT_TAG_VIEWS_FLAG = "htpr-8024-project-tag-views";

export default {
  key: HTPR_8024_PROJECT_TAG_VIEWS_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-26",
  description: "Create shared project views from tags and keep their names and filters aligned through tag renames and merges.",
  releaseRisk: {
    risk: "new",
    highRisk: "data-deletion",
    reason: "Tag merging moves task assignments and deletes the source tag. Off hides creation, rejects creation and merging on the server, and stops automatic rename updates; existing views and saved-data safeguards remain intact.",
  },
} as const satisfies FeatureFlagDefinition;
