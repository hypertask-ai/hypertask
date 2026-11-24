import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9071_INBOX_ZERO_IMAGE_FLAG = "htpr-9071-inbox-zero-image";

export default {
  key: HTPR_9071_INBOX_ZERO_IMAGE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-22",
  description:
    "An empty inbox shows only the inbox-zero image and its text. Split tabs and their bar come back when the inbox has items.",
  releaseRisk: {
    risk: "small",
    reason:
      "Hides the inbox split tabs while the inbox is empty. Off puts that bar back on the image. Tabs stay when the inbox has items.",
  },
} as const satisfies FeatureFlagDefinition;
