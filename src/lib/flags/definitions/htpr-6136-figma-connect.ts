import type { FeatureFlagDefinition } from "../definitions";

export const FIGMA_CONNECT_FLAG = "htpr-6136-figma-connect";

export default {
  key: FIGMA_CONNECT_FLAG,
  shippedOn: "2026-09-06",
  description: "Lets each user connect a Figma account so linked frames render as previews.",
} as const satisfies FeatureFlagDefinition;
