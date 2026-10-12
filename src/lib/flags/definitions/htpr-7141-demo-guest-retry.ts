import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7141_DEMO_GUEST_RETRY_FLAG = "htpr-7141-demo-guest-retry";

export default {
  key: HTPR_7141_DEMO_GUEST_RETRY_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-12",
  description: "Retries a dropped demo guest-board request so a brief network failure does not stop visitors reaching their board.",
  releaseRisk: { risk: "small", reason: "Client retries only requests that throw before a response, at most twice; HTTP errors and the existing guest rate limits are unchanged." },
} as const satisfies FeatureFlagDefinition;
