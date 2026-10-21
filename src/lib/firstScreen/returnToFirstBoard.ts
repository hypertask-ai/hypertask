import { getViewFromProject } from "./boardView";

type FirstProject = { id?: number | string };

const SESSION_REJECTED_STATUSES = new Set([400, 401]);

export async function returnToFirstBoard({
  getFirstProject,
  navigate,
  signOut,
}: {
  getFirstProject: () => Promise<{ data?: FirstProject }>;
  navigate: (url: string) => void;
  signOut: () => Promise<unknown>;
}): Promise<void> {
  let project: FirstProject | undefined;
  try {
    project = (await getFirstProject())?.data;
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === undefined || !SESSION_REJECTED_STATUSES.has(status)) {
      console.error("[unauthorized] first board lookup failed", error);
      return;
    }
  }
  if (project?.id == null) {
    await signOut();
    return;
  }
  const activeView = getViewFromProject(project);
  const view = activeView && activeView.type === "Applied" ? activeView.view.slug : undefined;
  navigate(`/project?id=${project.id}${view ? `&view=${view}` : ""}`);
}
