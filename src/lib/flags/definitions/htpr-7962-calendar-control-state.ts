import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7962_CALENDAR_CONTROL_STATE_FLAG = "htpr-7962-calendar-control-state";

export default {
  key: HTPR_7962_CALENDAR_CONTROL_STATE_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-15",
  description:
    "Calendar filter and sort buttons tell a screen reader when they are on, and an active filter or sort uses the board header theme colour.",
  releaseRisk: {
    risk: "small",
    reason:
      "Changes the accessible names of the calendar filter and sort buttons and swaps their active blue for the board header theme colour. Off restores the old names and the raw blue. Save view keeps its raw orange because no theme colour matches it.",
  },
} as const satisfies FeatureFlagDefinition;
