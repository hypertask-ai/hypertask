import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8349_STANDALONE_HTML_PAGE_FLAG = "htpr-8349-standalone-html-page";

export default {
  key: HTPR_8349_STANDALONE_HTML_PAGE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description: "An HTML page whose content brings its own styling or inline images is saved as an isolated document, so its style block and data images survive. Plain HTML snippets keep today's appearance.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes how self-contained HTML documents are stored and rendered; their styling and inline images used to be dropped. Off restores the previous flattened rendering.",
  },
} as const satisfies FeatureFlagDefinition;
