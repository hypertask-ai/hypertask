import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7514_INLINE_AGENT_IMAGES_FLAG = "htpr-7514-inline-agent-images";

export default {
  key: HTPR_7514_INLINE_AGENT_IMAGES_FLAG,
  kind: "feature",
  shippedOn: "2026-10-21",
  defaultMode: "EVERYONE",
  description: "Embed agent-handled images inline in task descriptions and comments unless the user asks for attachment or link only.",
  releaseRisk: {
    risk: "small",
    reason: "Adds inline previews to image writes while retaining attachments, existing sanitization and explicit opt-outs.",
  },
} as const satisfies FeatureFlagDefinition;
