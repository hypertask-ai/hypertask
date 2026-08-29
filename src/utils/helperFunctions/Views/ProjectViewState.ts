import type { IProject, IProjectView } from "@/models/model";

export const isProjectViewResponseForBoard = (
  value: unknown,
  projectId: number,
): value is IProjectView => {
  if (!value || typeof value !== "object") return false;

  const projectView = value as Partial<IProjectView>;
  return (
    typeof projectView.id === "string" &&
    projectView.projectId === projectId &&
    Array.isArray(projectView.allViews) &&
    Array.isArray(projectView.user_project_views)
  );
};

export const replaceProjectViewForCurrentBoard = (
  currentProject: IProject | null,
  projectId: number,
  projectView: IProjectView,
): IProject | null => {
  if (!currentProject || currentProject.id !== projectId) return currentProject;

  return {
    ...currentProject,
    project_view: projectView,
  };
};
