import type { FeatureFlagDefinition } from "../definitions";

export const LOCAL_WRITING_ASSISTANCE_FLAG = "htpr-5908-local-writing-assistance";

export default {
  key: LOCAL_WRITING_ASSISTANCE_FLAG,
  shippedOn: "2026-09-09",
  description:
    "Capitalizes the first letter typed in a paragraph or after sentence punctuation when the browser does not do it itself.",
  releaseRisk: {
    "risk": "small",
    "reason": "The existing editor capitalizes sentence starts when the browser does not."
  },
} as const satisfies FeatureFlagDefinition;
