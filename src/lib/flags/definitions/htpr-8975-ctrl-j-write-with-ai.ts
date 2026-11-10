import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8975_CTRL_J_WRITE_WITH_AI_FLAG = "htpr-8975-ctrl-j-write-with-ai";

export default {
  key: HTPR_8975_CTRL_J_WRITE_WITH_AI_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description:
    "Ctrl+J (Cmd+J on Mac) in a ticket comment, comment edit or description editor opens Write with AI instead of a new task. The Write with AI box matches the comment box: same well colour, no purple border, the same white mic and a text Rewrite button instead of the purple arrow.",
  releaseRisk: {
    risk: "small",
    reason:
      "Changes one shortcut inside ticket editors and restyles the Write with AI mic and submit button. Ctrl+J elsewhere still opens a new task. Off restores today's shortcut, mic and arrow.",
  },
} as const satisfies FeatureFlagDefinition;
