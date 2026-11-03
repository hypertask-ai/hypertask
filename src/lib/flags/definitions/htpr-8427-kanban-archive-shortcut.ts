import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8427_KANBAN_ARCHIVE_SHORTCUT_FLAG = "htpr-8427-kanban-archive-shortcut";

export default {
  key: HTPR_8427_KANBAN_ARCHIVE_SHORTCUT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description: "Archives the selected card every time the shortcut runs, even right after a G press.",
  releaseRisk: {
    risk: "small",
    reason: "Drops a stale board-sequence timestamp from the archive path; held-key repeats stay blocked and archive requests, Undo and navigation are unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
