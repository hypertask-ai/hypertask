import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8148_INBOX_TAB_SELECTION_FLAG = "htpr-8148-inbox-tab-selection";

export default {
  key: HTPR_8148_INBOX_TAB_SELECTION_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-28",
  defaultMode: "EVERYONE",
  description: "Keeps the Inbox select-all checkbox inside the open tab. Bulk archive changes only selected notifications, not other messages on the same ticket.",
  releaseRisk: {
    risk: "small",
    reason: "Narrows reversible Inbox archive to selected rows. Explicit global selection and Undo stay available; no tickets or comments are deleted.",
  },
} as const satisfies FeatureFlagDefinition;
