import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7978_AI_CHIP_EVENTS_FLAG = "htpr-7978-ai-chip-events";

export default {
  key: HTPR_7978_AI_CHIP_EVENTS_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Logs when AI chat suggestion chips show, which one is clicked, which are ignored and what the user types next, with board and chip type on every event. Nothing changes on screen.",
  related: ["htpr-7317-ctrlj-ticket-questions"],
  releaseRisk: {
    risk: "small",
    reason: "Adds one background log call per chip event and changes nothing users see. Off stops all chip logging.",
  },
} as const satisfies FeatureFlagDefinition;
