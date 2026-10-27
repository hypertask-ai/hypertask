import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7941_QUIET_FIXABLE_REPORTS_FLAG = "htpr-7941-quiet-fixable-reports";

export default {
  key: HTPR_7941_QUIET_FIXABLE_REPORTS_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "MCP calls refused for a field or value the caller can correct no longer file an AI feedback ticket, and a fingerprint already filed in the last day is not filed again.",
  releaseRisk: { risk: "small", reason: "Feedback filing only; flag Off files every refusal as today, and a refusal that names nothing the caller can fix still files a ticket." },
} as const satisfies FeatureFlagDefinition;
