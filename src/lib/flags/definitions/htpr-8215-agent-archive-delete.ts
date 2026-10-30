import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8215_AGENT_ARCHIVE_DELETE_FLAG = "htpr-8215-agent-archive-delete";

export default {
  key: HTPR_8215_AGENT_ARCHIVE_DELETE_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-30",
  description: "Agents can archive a ticket or move it to Trash through MCP and the CLI.",
  releaseRisk: {
    risk: "small",
    reason: "Adds MCP archive and delete doors that call the same archive and Trash writes the app uses, with the same board access checks; a deleted ticket stays in Trash for 30 days and can be restored, and disabling the flag stops the new doors without touching app writes.",
  },
} as const satisfies FeatureFlagDefinition;
