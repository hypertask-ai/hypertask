import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9019_SAVED_MODEL_AUTO_FLAG = "htpr-9019-saved-model-auto";

export default {
  key: HTPR_9019_SAVED_MODEL_AUTO_FLAG,
  kind: "improvement",
  shippedOn: "2026-11-10",
  defaultMode: "OWNER_AND_QA",
  description: "Switches each saved model choice to Auto once, for the users this flag is on for, and makes a saved Auto mean Auto on every AI text feature, not only chat, so the picker and the model that runs agree.",
  releaseRisk: {
    risk: "small",
    reason: "Old choices are copied to a backup table first, a later pick is never overwritten, and team feature models, agent pins and BYOK routing still win.",
  },
} as const satisfies FeatureFlagDefinition;
