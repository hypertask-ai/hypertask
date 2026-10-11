import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7051_TASK_WRITER_IMAGE_UNFURL_FLAG = "htpr-7051-task-writer-image-unfurl";

export default {
  key: HTPR_7051_TASK_WRITER_IMAGE_UNFURL_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-09",
  description: "Image URLs pasted into the Ctrl+J task writer keep their link and show the image in the description, like a manual paste.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only how pasted image links look in a new task description changes; the text is saved as before."
  },
} as const satisfies FeatureFlagDefinition;
