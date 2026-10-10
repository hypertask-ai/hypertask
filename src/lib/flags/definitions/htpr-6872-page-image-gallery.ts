import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6872_PAGE_IMAGE_GALLERY_FLAG = "htpr-6872-page-image-gallery";

export default {
  key: HTPR_6872_PAGE_IMAGE_GALLERY_FLAG,
  kind: "feature",
  shippedOn: "2026-10-03",
  description:
    "Lets you click images on pages to view them full size, browse all page images, and download them in the ticket image gallery.",
  releaseRisk: {
    "risk": "new",
    "reason": "Page images open in a full-size gallery with browsing and download controls."
  },
} as const satisfies FeatureFlagDefinition;
