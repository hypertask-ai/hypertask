import type { IProject, ITeam } from "@/models/model";

export type LastUsedBoards = Record<number, number | undefined>;

/**
 * Same ordering the left sidebar (Ctrl+B board switcher) uses for its
 * "Teams" group when board-sort-mode isn't the flattened "lastUsed" view:
 * most-used team first (by its most recently opened board), alphabetical
 * fallback for teams with no activity yet, boards within a team by id.
 * Extracted so the Alt+Shift+Arrow team-cycle shortcut can walk the exact
 * same list instead of re-deriving a similar-but-different order.
 */
export const orderTeamsForSwitcher = (
  teams: ITeam[],
  lastUsedBoards: LastUsedBoards,
): ITeam[] => {
  const teamUsage = (team: ITeam) =>
    (team.projects || []).reduce(
      (latest, project) => Math.max(latest, lastUsedBoards[project.id] || 0),
      0,
    );

  return [...teams]
    .sort((a, b) => {
      const usageDiff = teamUsage(b) - teamUsage(a);
      if (usageDiff !== 0) return usageDiff;
      return (a.title || "").localeCompare(b.title || "");
    })
    .map((team) => ({
      ...team,
      projects: team.projects
        ? ([...team.projects].sort(
            (a: IProject, b: IProject) => a.id - b.id,
          ) as IProject[])
        : [],
    }));
};
