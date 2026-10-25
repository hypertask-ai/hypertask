import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7894_TASK_ID_TICKET_REFERENCE_FLAG = "htpr-7894-task-id-ticket-reference";

export default {
  key: HTPR_7894_TASK_ID_TICKET_REFERENCE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "Lets MCP tool calls pass a ticket reference such as HTPR-1234 in task_id, where it is read as ticket_number instead of failing as a non-numeric id.",
  releaseRisk: { risk: "small", reason: "Input compatibility only; flag Off keeps today's refusal, numeric task ids are untouched, and an explicit ticket_number always wins." },
} as const satisfies FeatureFlagDefinition;
