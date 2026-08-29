import { IProject, ISection } from "@/models/model";
import generateRank from "@/utils/generateRank";

export const getSectionId = (section: ISection) =>
  section.id ?? section.sectionId;

export const reorderSectionsWithRank = (
  sections: ISection[],
  sourceIndex: number,
  destinationIndex: number
) => {
  const reorderedSections = [...sections];
  const [draggedSection] = reorderedSections.splice(sourceIndex, 1);
  const ranking = generateRank(
    reorderedSections[destinationIndex - 1]?.ranking,
    reorderedSections[destinationIndex]?.ranking
  );
  const updatedSection = { ...draggedSection, ranking };

  reorderedSections.splice(destinationIndex, 0, updatedSection);

  return { reorderedSections, updatedSection, ranking };
};

export const applyVisibleSectionOrder = (
  sections: ISection[],
  visibleSections: ISection[]
) => {
  const visibleIds = new Set(visibleSections.map(getSectionId));
  let visibleIndex = 0;

  return sections.map((section) =>
    visibleIds.has(getSectionId(section))
      ? visibleSections[visibleIndex++]
      : section
  );
};

const mergeReorderedSections = (
  sections: ISection[],
  reorderedSections: ISection[]
) => {
  const currentById = new Map(
    sections.map((section) => [getSectionId(section), section])
  );
  const reorderedCurrentSections = reorderedSections
    .filter((section) => currentById.has(getSectionId(section)))
    .map((section) => ({
      ...currentById.get(getSectionId(section))!,
      ranking: section.ranking,
    }));

  return applyVisibleSectionOrder(sections, reorderedCurrentSections);
};

/**
 * Keep every in-memory representation of a board aligned after a visible
 * column reorder. Hidden and filtered-out columns keep their existing slots,
 * while the moved columns carry their canonical rankings into each list.
 */
export const applyReorderedSectionsToProject = (
  project: IProject,
  reorderedSections: ISection[]
): IProject => ({
  ...project,
  ...(Array.isArray(project.section)
    ? { section: mergeReorderedSections(project.section, reorderedSections) }
    : {}),
  ...(Array.isArray(project.sections)
    ? { sections: mergeReorderedSections(project.sections, reorderedSections) }
    : {}),
  ...(Array.isArray(project.filteredSections)
    ? {
        filteredSections: mergeReorderedSections(
          project.filteredSections,
          reorderedSections
        ),
      }
    : {}),
});
