import type { ITeam } from "@/models/model";

export function sortBoardsByRecent(
  teams: ITeam[],
  recentIds: number[]
): ITeam[] {
  const recentIndexById = new Map<number, number>();
  recentIds.forEach((id, index) => {
    if (!recentIndexById.has(id)) recentIndexById.set(id, index);
  });
  const bestRecentIndex = (team: ITeam) =>
    Math.min(
      ...team.projects.map(
        (project) => recentIndexById.get(project.id) ?? Infinity
      )
    );

  return teams
    .filter((team) => team.projects?.length)
    .map((team) => ({
      ...team,
      projects: [...team.projects].sort((a, b) => {
        const recentIndexA = recentIndexById.get(a.id);
        const recentIndexB = recentIndexById.get(b.id);

        if (recentIndexA === undefined && recentIndexB === undefined) return 0;
        if (recentIndexA === undefined) return 1;
        if (recentIndexB === undefined) return -1;
        return recentIndexA - recentIndexB;
      }),
    }))
    .sort((a, b) => {
      const recentIndexA = bestRecentIndex(a);
      const recentIndexB = bestRecentIndex(b);

      if (recentIndexA === Infinity && recentIndexB === Infinity) return 0;
      return recentIndexA - recentIndexB;
    });
}
