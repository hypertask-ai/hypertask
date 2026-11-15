import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9064_LATEST_UPDATES_WEEK_FLAG = "htpr-9064-latest-updates-week";

export default {
  key: HTPR_9064_LATEST_UPDATES_WEEK_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-15",
  description: "Latest Updates reaches back a week of notes, groups them by day, and names the last notes job run in the panel footer.",
  releaseRisk: {
    risk: "small",
    reason: "Only the Latest Updates panel shows more notes, day headings and one footer line. Off shows the newest 15 notes in one flat list with no footer line.",
  },
} as const satisfies FeatureFlagDefinition;
