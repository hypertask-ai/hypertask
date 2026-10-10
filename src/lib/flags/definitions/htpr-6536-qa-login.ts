import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6536_QA_LOGIN_FLAG = "htpr-6536-qa-login";

export default {
  key: HTPR_6536_QA_LOGIN_FLAG,
  shippedOn: "2026-09-16",
  description:
    "Shows a QA-only email and password sign-in page so an outside test robot can open the real app behind login. The page and route exist only when the server has the QA login secrets.",
  releaseRisk: {
    "risk": "new",
    "reason": "Adds a dedicated QA sign-in page for automated testing."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
