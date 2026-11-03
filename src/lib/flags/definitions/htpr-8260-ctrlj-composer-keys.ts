import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8260_CTRLJ_COMPOSER_KEYS_FLAG = "htpr-8260-ctrlj-composer-keys";

export default {
  key: HTPR_8260_CTRLJ_COMPOSER_KEYS_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-02",
  description: "Ctrl+J New Task moves the microphone left of a Create text button, spells every footer key in words, and shows a Dictation pill while it listens.",
  releaseRisk: {
    risk: "small",
    reason: "Moves the existing composer controls, puts the microphone beside Create, and rewrites its key hints; Enter, dictation, attach and the board picker keep their behavior, and turning the flag off restores today's row and footer.",
  },
} as const satisfies FeatureFlagDefinition;
