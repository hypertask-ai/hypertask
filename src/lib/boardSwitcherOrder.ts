import type { IProject } from "@/models/model";

export type BoardLastActivity = Record<number, string | null | undefined>;

const activityTime = (
  project: IProject,
  lastActivity: BoardLastActivity,
): number => {
  const value = lastActivity[project.id];
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Order for the Change Board switcher (HTPR-5476).
 *
 * The current board stays pinned at the top so the list opens on where you
 * already are. Everything else is most-recently-active first, because the
 * board you want next is nearly always one that just moved. Boards with no
 * task activity fall to the end, alphabetically, instead of landing in
 * creation order.
 */
export const orderBoardsForSwitcher = (
  projects: IProject[],
  lastActivity: BoardLastActivity,
  currentProjectId?: number,
): IProject[] => {
  const rest = projects.filter((project) => project.id !== currentProjectId);
  rest.sort((a, b) => {
    const diff = activityTime(b, lastActivity) - activityTime(a, lastActivity);
    if (diff !== 0) return diff;
    return (a.title ?? a.name ?? "").localeCompare(b.title ?? b.name ?? "");
  });
  const current = projects.find((project) => project.id === currentProjectId);
  return current ? [current, ...rest] : rest;
};
