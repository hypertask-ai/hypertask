import type { FeatureFlagDefinition } from "../definitions";

export const CONFIRMED_PROPOSAL_HEADING_FLAG = "htpr-6197-confirmed-proposal-heading";

export default {
  key: CONFIRMED_PROPOSAL_HEADING_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-09-08",
  description:
    "Head the Agent Chat proposal card 'Ticket created' once the ticket exists, instead of 'Ticket proposed, nothing done yet'.",
} as const satisfies FeatureFlagDefinition;
