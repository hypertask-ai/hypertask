import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7656_CTRLJ_SKILL_MENU_FLAG = "htpr-7656-ctrlj-skill-menu";

export default {
  key: HTPR_7656_CTRLJ_SKILL_MENU_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description: "Typing / in the Ctrl+J New Task box opens the same skill picker the AI task writer and comments show, so a skill can be picked by name.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the task writer's existing skill picker unchanged; it only opens after a / token and steps aside for Escape and Tab while open. Off restores the plain Ctrl+J box.",
  },
} as const satisfies FeatureFlagDefinition;
