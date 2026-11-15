import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9064_LATEST_UPDATES_WEEK_FLAG = "htpr-9064-latest-updates-week";

export default {
  key: HTPR_9064_LATEST_UPDATES_WEEK_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-15",
  description: "Latest Updates reaches back a week of notes and groups them under day headings.",
  releaseRisk: {
    risk: "small",
    reason: "Only the Latest Updates panel shows a week of notes with day headings. Off shows the newest 15 notes in one flat list.",
  },
} as const satisfies FeatureFlagDefinition;
