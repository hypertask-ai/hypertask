import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7699_DESKTOP_CLI_TOKEN_FLAG = "htpr-7699-desktop-cli-token";

export default {
  key: HTPR_7699_DESKTOP_CLI_TOKEN_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-24",
  description: "Lets a person's desktop CLI login use Task Writer, creation defaults, comment stars and pins, and mention suggestions without changing cookie access.",
  releaseRisk: {
    risk: "new",
    highRisk: "access",
    reason: "Adds human CLI bearer access to four existing web APIs while preserving their cookie paths and permission checks.",
  },
} as const satisfies FeatureFlagDefinition;
