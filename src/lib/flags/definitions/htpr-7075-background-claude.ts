import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7075_BACKGROUND_CLAUDE_FLAG = "htpr-7075-background-claude";

// HTPR-7075 (https://app.hypertask.ai/detail/project-15/7075): Valentin decided on 2026-10-10 that every
// background AI job runs on the Anthropic key, so this bug fix is on for Everyone.
export default {
  key: HTPR_7075_BACKGROUND_CLAUDE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-10",
  description:
    "Runs every background AI job (summaries, titles, memory, heartbeats, classifiers) on Claude 5.5 through our Anthropic key and maps saved older Claude picks to the 5.5 model of the same class. Off keeps the old model ladders.",
  releaseRisk: {
    "risk": "small",
    "reason": "Automatic summaries, titles and other background AI text now come from Claude 5.5, and older Claude models leave the pickers."
  },
} as const satisfies FeatureFlagDefinition;
