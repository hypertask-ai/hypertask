import { columnRole } from "../lib/mcp/boards/columnRole";
import type { ISection } from "../models/model";

const getSectionId = (section: ISection) => section.sectionId ?? section.id;

export const getAcceptDestination = (
  sections: ISection[],
  currentSectionId: number
): ISection | undefined => {
  const orderedSections = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => getSectionId(section) !== undefined)
    .sort((left, right) => {
      if (left.section.ranking == null && right.section.ranking != null) return 1;
      if (left.section.ranking != null && right.section.ranking == null) return -1;
      const rankingComparison = (left.section.ranking ?? "").localeCompare(
        right.section.ranking ?? ""
      );
      return rankingComparison || left.index - right.index;
    })
    .map(({ section }) => section);
  const currentSectionIndex = orderedSections.findIndex(
    (section) => getSectionId(section) === currentSectionId
  );

  if (currentSectionIndex === -1) return undefined;

  const laterSections = orderedSections.slice(currentSectionIndex + 1);
  const currentSection = orderedSections[currentSectionIndex];

  if (columnRole(currentSection.section_title) === "intake") {
    return laterSections.find(
      (section) => columnRole(section.section_title) !== "intake"
    );
  }

  return laterSections[0];
};
