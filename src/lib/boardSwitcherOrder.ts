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
