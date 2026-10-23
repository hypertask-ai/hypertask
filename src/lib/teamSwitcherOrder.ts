import type { IProject, ITeam } from "@/models/model";

export type LastUsedBoards = Record<number, number | undefined>;

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
