import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7939_GROK_GEMINI4_MODELS_FLAG = "htpr-7939-grok-gemini4-models";

export default {
  key: HTPR_7939_GROK_GEMINI4_MODELS_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-26",
  description: "Adds Grok 4.7 and Gemini 4 Argon to the model pickers, with the xAI provider row and settings commands. Off hides them and uses the plan default for saved or requested choices.",
  releaseRisk: { risk: "new", highRisk: "money", reason: "Adds two optional gateway models at the same price tier as existing ones; existing models and defaults are unchanged and flag Off restores today's pickers." },
} as const satisfies FeatureFlagDefinition;
