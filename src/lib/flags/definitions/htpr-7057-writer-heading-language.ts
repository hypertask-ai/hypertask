import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7057_WRITER_HEADING_LANGUAGE_FLAG = "htpr-7057-writer-heading-language";

export default {
  key: HTPR_7057_WRITER_HEADING_LANGUAGE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-10",
  description:
    "Writes the entire Task Writer ticket, including section headings, in the requested language or the language of the request while preserving section structure.",
  releaseRisk: {
    "risk": "small",
    "reason": "Task Writer tickets, including their section headings, are written in the language you asked for or wrote the request in."
  },
} as const satisfies FeatureFlagDefinition;
