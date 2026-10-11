import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7090_COMMENT_LINK_SCROLL_FLAG = "htpr-7090-comment-link-scroll";

export default {
  key: HTPR_7090_COMMENT_LINK_SCROLL_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-10",
  description:
    "Opening a link to a comment as a fresh page load scrolls to that comment instead of staying near the top of the ticket.",
  releaseRisk: {
    "risk": "small",
    "reason": "A ticket opened from a comment link now lands on the linked comment; opening tickets without a comment link and opening links from inside the app are unchanged."
  },
} as const satisfies FeatureFlagDefinition;
