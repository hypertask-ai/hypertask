import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8339_TEMPLATE_SWITCH_QUESTION_FLAG = "htpr-8339-template-switch-question";

export default {
  key: HTPR_8339_TEMPLATE_SWITCH_QUESTION_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-03",
  description: "On lets a Question comment written in the required ticket shape approve a flag switch, because the switch wording is read from its Question line instead of the whole comment. Off restores the old rule, where the Yes and No answer lines and the plain-words context block refuse every shaped Question.",
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason: "Changes which comments may record Valentin's approval of a flag switch; the hedging guards still run on the Question line, and turning the flag off restores the current refusals.",
  },
} as const satisfies FeatureFlagDefinition;
