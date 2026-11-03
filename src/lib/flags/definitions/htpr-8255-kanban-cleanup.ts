import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8255_KANBAN_CLEANUP_FLAG = "htpr-8255-kanban-cleanup";

export default {
  key: HTPR_8255_KANBAN_CLEANUP_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description: "Kanban cleanup: cards at a 6px radius with one shadow, chips at 4px, plain cards lose the hidden left stroke, card and column spacing on the 4/8/12 scale, 20px card avatars and pill scroll thumbs.",
  releaseRisk: {
    risk: "small",
    reason: "Rounds corners, removes an invisible card stroke and snaps card spacing to the existing scale. Column order, stacking, colours and every other view stay as they are; Off restores the previous classes.",
  },
} as const satisfies FeatureFlagDefinition;
