import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7914_TICKET_NUMBER_HINT_FLAG = "htpr-7914-ticket-number-hint";

export default {
  key: HTPR_7914_TICKET_NUMBER_HINT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "Tells an MCP caller who passes a numeric ticket_number which shapes do work: a string like HTPR-7914, task_id, or unique_index with project_id.",
  releaseRisk: { risk: "small", reason: "Refusal text only; flag Off keeps today's generic invalid-input message, and a correctly shaped call is untouched." },
} as const satisfies FeatureFlagDefinition;
