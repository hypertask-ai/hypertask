import type { IProject, ISection } from "@/models/model";

/**
 * Put a just-created column into the cached project's canonical section list.
 *
 * HTPR-5542: creating a column only wrote the refreshed `project_view` back into
 * the cache. A board that has never saved a view has no Project_View row at all,
 * so the create route answers with `project_view: null`, the cache update was
 * skipped entirely, and the new column did not appear until a reload. The board
 * also falls back to `project.section` when no view exists, so the section list
 * is what has to carry the new column.
 *
 * Appending here is safe when a view does exist too: the column is already in
 * the view array, and the section entry is what gives it its canonical ranking.
 */
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
