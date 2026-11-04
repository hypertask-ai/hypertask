import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8255_KANBAN_CLEANUP_FLAG = "htpr-8255-kanban-cleanup";

export default {
  key: HTPR_8255_KANBAN_CLEANUP_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description: "Kanban cleanup: Graphite 2 cards and columns at a 4px radius, chips at most 4px, square scroll thumbs, one card shadow, no hidden left stroke, card and column spacing on the 4/8/12 scale, and 20px card avatars.",
  releaseRisk: {
    risk: "small",
    reason: "Rounds corners, removes an invisible card stroke and snaps card spacing to the existing scale. Column order, stacking, colours and every other view stay as they are; Off restores the previous classes.",
  },
} as const satisfies FeatureFlagDefinition;
