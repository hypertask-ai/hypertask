import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8471_BOARD_REFUSAL_NEXT_STEP_FLAG = "htpr-8471-board-refusal-next-step";

export default {
  key: HTPR_8471_BOARD_REFUSAL_NEXT_STEP_FLAG,
  kind: "bugfix",
  shippedOn: "2026-11-04",
  description: "Creating a ticket through MCP on a board the agent is not on names the board access request tool instead of only asking for an owner, so the agent can act.",
  releaseRisk: { risk: "small", reason: "Only changes the guidance text of an existing 403 refusal; the status, error code and field stay the same, and successful creates are untouched." },
} as const satisfies FeatureFlagDefinition;
