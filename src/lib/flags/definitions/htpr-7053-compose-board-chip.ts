import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7053_COMPOSE_BOARD_CHIP_FLAG = "htpr-7053-compose-board-chip";

export default {
  key: HTPR_7053_COMPOSE_BOARD_CHIP_FLAG,
  kind: "feature",
  shippedOn: "2026-10-11",
  description: "Shows the Ctrl+J target board in inbox and mixed-board views, using the focused ticket, open board split, or last used board. The chat board chip and Select Board list let you change it by keyboard.",
  releaseRisk: {
    risk: "new",
    reason: "Changes where inbox Ctrl+J tasks are created and adds an explicit keyboard-accessible board choice.",
  },
} as const satisfies FeatureFlagDefinition;
