import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9275_UNEXPLAINED_AGENT_REPORT_FLAG = "htpr-9275-unexplained-agent-report";

export default {
  key: HTPR_9275_UNEXPLAINED_AGENT_REPORT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-14",
  description: "An agent report that names a tool, carries no HTTP status, error code, field or kept note, and says only that something had a problem no longer opens a ticket; the reply asks for the details instead.",
  releaseRisk: {
    risk: "small",
    reason: "Only skips opening a new ticket for a report nobody can act on. A report with a status, error code, field or kept note still files, and a repeat report still joins its open ticket. Off keeps today's filing.",
  },
} as const satisfies FeatureFlagDefinition;
