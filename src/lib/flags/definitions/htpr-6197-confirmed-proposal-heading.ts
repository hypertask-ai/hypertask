import type { FeatureFlagDefinition } from "../definitions";

export const CONFIRMED_PROPOSAL_HEADING_FLAG = "htpr-6197-confirmed-proposal-heading";

export default {
  key: CONFIRMED_PROPOSAL_HEADING_FLAG,
  shippedOn: "2026-09-08",
  description:
    "Head the Agent Chat proposal card 'Ticket created' once the ticket exists, instead of 'Ticket proposed, nothing done yet'.",
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
} as const satisfies FeatureFlagDefinition;
