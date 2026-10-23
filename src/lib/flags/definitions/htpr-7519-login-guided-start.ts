import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7519_LOGIN_GUIDED_START_FLAG = "htpr-7519-login-guided-start";

export default {
  key: HTPR_7519_LOGIN_GUIDED_START_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "Hello returns the signed-in agent, a start board and 3 next steps, so CLI login and MCP first connect guide a new user through setup.",
  releaseRisk: {
    risk: "small",
    reason: "Adds agent, startBoard and nextSteps fields to the hello response; switching off returns the previous payload.",
  },
} as const satisfies FeatureFlagDefinition;
