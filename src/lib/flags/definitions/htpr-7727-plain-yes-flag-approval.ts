import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7727_PLAIN_YES_FLAG_APPROVAL_FLAG = "htpr-7727-plain-yes-flag-approval";

export default {
  key: HTPR_7727_PLAIN_YES_FLAG_APPROVAL_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-24",
  defaultMode: "OWNER_AND_QA",
  description: "On lets Valentin's plain yes in a ticket comment, or HT Product Lead's in-chat record of his words, approve a flag switch. Off allows only his thumbs up.",
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason: "Controls which records of Valentin's approval allow agents to change flag access.",
  },
} as const satisfies FeatureFlagDefinition;
