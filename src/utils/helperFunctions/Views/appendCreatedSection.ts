import type { IProject, ISection } from "@/models/model";

export const appendCreatedSectionToProject = (
  project: IProject,
  createdSection?: ISection | null
): IProject => {
  if (!createdSection) return project;

  const sectionId = createdSection.id ?? createdSection.sectionId;
  if (sectionId === undefined) return project;

  const existing = project.section ?? [];
  if (existing.some((section) => (section.id ?? section.sectionId) === sectionId)) {
    return project;
  }

  return {
    ...project,
    section: [...existing, { ...createdSection, items: createdSection.items ?? [] }],
  };
};
