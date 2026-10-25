import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7885_INVITE_LINK_DIALOG_FLAG = "htpr-7885-invite-link-dialog";

export default {
  key: HTPR_7885_INVITE_LINK_DIALOG_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "Restores the invite dialog for desktop board links carrying invite=1 after the startup palette reset.",
  releaseRisk: {
    risk: "small",
    reason: "Only re-opens the invite dialog for a board link carrying invite=1 on desktop. Off keeps today's behavior; phone and board Invite button behavior are unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
