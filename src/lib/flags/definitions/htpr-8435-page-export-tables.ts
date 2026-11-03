import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8435_PAGE_EXPORT_TABLES_FLAG = "htpr-8435-page-export-tables";

export default {
  key: HTPR_8435_PAGE_EXPORT_TABLES_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description: "Reading a page as markdown keeps its tables and code blocks instead of flattening them to loose text.",
  releaseRisk: {
    risk: "small",
    reason: "Changes only the markdown text a page read returns; stored page HTML, page writes and the html format stay unchanged. Off restores the flattened export.",
  },
} as const satisfies FeatureFlagDefinition;
