import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8830_CHAT_PLUS_COMPOSER_FLAG = "htpr-8830-chat-plus-composer";

export default {
  key: HTPR_8830_CHAT_PLUS_COMPOSER_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-07",
  description:
    "Sidebar and floating AI chat put a + menu, the white mic and a text Send inside the box. The menu attaches a file or adds @ context. Project, model and effort sit below the box.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only rearranges the existing desktop sidebar and floating chat controls. Attach, @ context, dictation, send and shortcuts keep working, and Off restores today's row.",
  },
} as const satisfies FeatureFlagDefinition;
