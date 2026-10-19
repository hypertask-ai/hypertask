import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7381_REALTIME_TOKEN_AUTH_FLAG = "htpr-7381-realtime-token-auth";

export default {
  key: HTPR_7381_REALTIME_TOKEN_AUTH_FLAG,
  kind: "feature",
  shippedOn: "2026-10-20",
  description: "Apps that sign in with a Hypertask access token, like the native desktop app, get live board, task and inbox updates instead of checking every few seconds.",
  releaseRisk: {
    risk: "small",
    reason: "Only adds a second way to sign in to live updates; browser sign-in and every channel permission check stay exactly the same.",
  },
} as const satisfies FeatureFlagDefinition;
