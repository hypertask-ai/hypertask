import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9369_VIEW_EMPTY_COLUMNS_FLAG = "htpr-9369-view-empty-columns";

export default {
  key: HTPR_9369_VIEW_EMPTY_COLUMNS_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-16",
  description: "Lets agents save a board view with empty columns hidden through the MCP view tools.",
  releaseRisk: {
    risk: "small",
    reason: "Only accepts a setting the board already saves; dropping the field restores today's behaviour.",
  },
} as const satisfies FeatureFlagDefinition;
