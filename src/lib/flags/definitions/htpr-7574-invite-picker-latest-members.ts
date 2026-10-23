import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7574_INVITE_PICKER_LATEST_MEMBERS_FLAG = "htpr-7574-invite-picker-latest-members";

export default {
  key: HTPR_7574_INVITE_PICKER_LATEST_MEMBERS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "The invite picker keeps only the newest members and agents list, so an older answer can no longer replace it and drop agents you can add to the board.",
  releaseRisk: {
    risk: "small",
    reason: "Only ignores member list answers from an earlier render of the open picker; the request, the list contents and who can add whom are unchanged. Off restores the old last-answer-wins behaviour.",
  },
} as const satisfies FeatureFlagDefinition;
