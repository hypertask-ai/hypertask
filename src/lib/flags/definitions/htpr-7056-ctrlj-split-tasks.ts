import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7056_CTRLJ_SPLIT_TASKS_FLAG = "htpr-7056-ctrlj-split-tasks";

export default {
  key: HTPR_7056_CTRLJ_SPLIT_TASKS_FLAG,
  kind: "feature",
  shippedOn: "2026-10-10",
  description: "Creates up to ten separate tickets from a Ctrl+J prompt that clearly asks for independent tasks and lists every saved ticket in the result.",
  releaseRisk: {
    "risk": "new",
    "reason": "A Ctrl+J message that asks for several separate tasks creates one ticket per task and lists them all."
  },
} as const satisfies FeatureFlagDefinition;
