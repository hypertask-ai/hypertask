import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9028_INLINE_CREATION_SCREENSHOTS_FLAG = "htpr-9028-inline-creation-screenshots";

export default {
  key: HTPR_9028_INLINE_CREATION_SCREENSHOTS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description:
    "A screenshot pasted or attached while creating a task in Task Writer, Write with AI, or the sidebar AI chat is embedded in the new description even when the model omits it.",
  releaseRisk: {
    risk: "small",
    reason:
      "Adds the screenshot the user already supplied to the new task description. Off leaves embedding to the model. An explicit attachment-only or link-only request still stays a link.",
  },
} as const satisfies FeatureFlagDefinition;
