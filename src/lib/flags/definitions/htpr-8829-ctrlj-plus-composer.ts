import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8829_CTRLJ_PLUS_COMPOSER_FLAG = "htpr-8829-ctrlj-plus-composer";

export default {
  key: HTPR_8829_CTRLJ_PLUS_COMPOSER_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-05",
  description:
    "Ctrl+J New Task puts a + menu, the white mic and a text Send inside the box. The menu attaches a file or inserts @ context. Board and model pickers sit below the box.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only moves existing desktop Ctrl+J controls. Every shortcut, the board picker, the model picker, attach and dictation keep working, and Off restores today's layout.",
  },
} as const satisfies FeatureFlagDefinition;
