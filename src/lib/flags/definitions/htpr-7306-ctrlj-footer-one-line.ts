import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7306_CTRLJ_FOOTER_ONE_LINE_FLAG = "htpr-7306-ctrlj-footer-one-line";

export default {
  key: HTPR_7306_CTRLJ_FOOTER_ONE_LINE_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "Hide the Esc Close hint in the desktop Ctrl+J New Task footer so its shortcuts fit on one line.",
  releaseRisk: {
    risk: "small",
    reason: "Only hides a desktop shortcut hint; Escape still closes New Task and the phone layout is unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
