import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7761_CHAT_IMAGE_URLS_FLAG = "htpr-7761-chat-image-urls";

export default {
  key: HTPR_7761_CHAT_IMAGE_URLS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Sends direct image links in AI chat as image content and distinguishes image download failures from model limitations.",
  releaseRisk: {
    risk: "small",
    reason: "Only prepares image inputs for chat using the existing bounded, public-address-only attachment downloader. Off restores text-only image links.",
  },
} as const satisfies FeatureFlagDefinition;
