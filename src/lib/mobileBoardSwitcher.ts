import type { IProject } from "@/models/model";
import {
  orderBoardsForSwitcher,
  type BoardLastActivity,
} from "@/lib/boardSwitcherOrder";

const boardTitle = (project: IProject): string =>
  project.title ?? project.name ?? "";

export const filterBoardsForSwitcher = (
  projects: IProject[],
  lastActivity: BoardLastActivity,
  currentProjectId: number | undefined,
  keyword: string,
): IProject[] => {
  const normalizedKeyword = keyword.trim().toLowerCase();
  const ordered = orderBoardsForSwitcher(
    projects,
    lastActivity,
    currentProjectId,
  );

  if (!normalizedKeyword) return ordered;

  return ordered.filter((project) =>
    boardTitle(project).toLowerCase().includes(normalizedKeyword),
  );
};

export const getMobileBoardSwitcherOptions = ({
  projects,
  lastActivity,
  currentProjectId,
  keyword,
}: {
  projects: IProject[];
  lastActivity: BoardLastActivity | null;
  currentProjectId: number | undefined;
  keyword: string;
}): IProject[] => {
  if (lastActivity === null) return [];
  return filterBoardsForSwitcher(
    projects,
    lastActivity,
    currentProjectId,
    keyword,
  );
};

export const getNextMobileBoardSelection = (
  selectedIndex: number,
  boardCount: number,
  key: "ArrowDown" | "ArrowUp",
): number => {
  if (boardCount === 0) return 0;
  if (key === "ArrowDown") return Math.min(selectedIndex + 1, boardCount - 1);
  return Math.max(selectedIndex - 1, 0);
};

export const getMobileBoardOptionId = (projectId: number): string =>
  `mobile-board-option-${projectId}`;
