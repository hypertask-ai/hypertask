import { deriveCurrentBoardBilling } from "@/lib/deriveCurrentBoardBilling";
import type { IProject } from "@/models/model";
import type { CurrentBoardBilling } from "@/store";

export function resolveTaskWriterBoardContext({
  destinationProject,
  openProject,
  openBilling,
}: {
  destinationProject?: IProject;
  openProject: IProject | null;
  openBilling: CurrentBoardBilling | null;
}) {
  const project = destinationProject ?? openProject;
  const billing = destinationProject
    ? deriveCurrentBoardBilling(destinationProject)
    : openBilling;

  return {
    project,
    billing,
    teamId: project?.teamId ?? null,
    boardDefaultId:
      project?.ai_custom_instructions?.[0]?.model_selected ?? null,
  };
}

export function buildTaskWriterRequestScope(
  project: IProject | null | undefined,
  billing: CurrentBoardBilling | null | undefined,
) {
  return {
    projectId: project?.id ?? -1,
    teamId: project?.teamId ?? -1,
    byokProviderFlags: billing?.byokProviderFlags ?? [],
  };
}
