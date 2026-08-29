import type { IAgent, IProject, ISection, IUser } from "@/models/model";

export type SectionAutoAssignTarget = {
  autoAssignAgentId: string | null;
  autoAssignUserId: number | null;
};

export function sectionAutoAssignTargetFor(
  assignee: Pick<IUser | IAgent, "id">,
): SectionAutoAssignTarget {
  if (typeof assignee.id === "string") {
    return {
      autoAssignAgentId: assignee.id,
      autoAssignUserId: null,
    };
  }

  return {
    autoAssignAgentId: null,
    autoAssignUserId: assignee.id === 0 ? null : assignee.id,
  };
}

export function hasNoSectionAutoAssign(
  section: Pick<ISection, "autoAssignAgentId" | "autoAssignUserId">,
) {
  return section.autoAssignAgentId == null && section.autoAssignUserId == null;
}

export function syncSectionAutoAssignFromCanonical(
  viewSection: ISection,
  canonicalSection?: ISection,
): ISection {
  if (
    !canonicalSection ||
    (canonicalSection.autoAssignAgentId === undefined &&
      canonicalSection.autoAssignUserId === undefined)
  ) {
    return viewSection;
  }

  return {
    ...viewSection,
    autoAssignAgentId: canonicalSection.autoAssignAgentId ?? null,
    autoAssignUserId: canonicalSection.autoAssignUserId ?? null,
  };
}

export function applySectionAutoAssignToProject(
  project: IProject,
  projectId: number,
  sectionId: number,
  target: SectionAutoAssignTarget,
): IProject {
  if (project.id !== projectId) return project;

  const updateSections = (sections?: ISection[]) =>
    sections?.map((section) =>
      (section.id ?? section.sectionId) === sectionId
        ? { ...section, ...target }
        : section,
    );

  return {
    ...project,
    section: updateSections(project.section) ?? project.section,
    sections: updateSections(project.sections) ?? project.sections,
    filteredSections:
      updateSections(project.filteredSections) ?? project.filteredSections,
  };
}
