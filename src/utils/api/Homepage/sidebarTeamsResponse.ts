import type { ITeam } from "@/models/model";

export const SIDEBAR_TEAMS_PATH = "/teams/getAllSidebar";
export const SIDEBAR_TEAMS_CACHE_VERSION = 2;

export const sidebarTeamsQueryKey = (userId: number | null) =>
  ["getAllTeamsMinimal", userId, SIDEBAR_TEAMS_CACHE_VERSION] as const;

export const requireSidebarTeams = (data: unknown): ITeam[] => {
  if (!Array.isArray(data)) {
    throw new Error("Invalid sidebar teams response");
  }

  return data as ITeam[];
};

export const selectSidebarTeams = (data: unknown): ITeam[] =>
  Array.isArray(data) ? (data as ITeam[]) : [];
