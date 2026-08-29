import type { IProject } from "@/models/model";

export function getSettingsProjectForTeam(
  teamId: string | null,
  currentProject: IProject | null,
  projects: IProject[],
  previousBoardProjectId: string | null = null
): IProject | null {
  if (!teamId) return null;
  if (currentProject?.teamId === teamId) return currentProject;

  const teamProjects = projects.filter((project) => project.teamId === teamId);
  const previousBoardProject = previousBoardProjectId
    ? teamProjects.find(
        (project) => String(project.id) === previousBoardProjectId
      )
    : null;

  return previousBoardProject ?? teamProjects[0] ?? null;
}

export function getInitialSettingsTeamId(
  availableTeamIds: string[],
  currentProject: IProject | null,
  projects: IProject[],
  previousBoardProjectId: string | null = null
): string | null {
  const available = new Set(availableTeamIds);

  if (currentProject?.teamId && available.has(currentProject.teamId)) {
    return currentProject.teamId;
  }

  const previousProject = previousBoardProjectId
    ? projects.find(
        (project) => String(project.id) === previousBoardProjectId
      )
    : null;

  if (previousProject?.teamId && available.has(previousProject.teamId)) {
    return previousProject.teamId;
  }

  return availableTeamIds[0] ?? null;
}
