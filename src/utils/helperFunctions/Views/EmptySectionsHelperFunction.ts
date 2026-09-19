import { IProject, ISection } from "@/models/model";
import { TBoardEmptySections } from "@/models/Views/model";
import type { EmptyStateCause } from "./BoardEmptyStateHelper";
import { getActiveEmptySectionSettingFromProject } from "./ViewsHelperFunctions";

export const defaultEmptySections: TBoardEmptySections = "Show";

export const shouldHoldEmptySectionsAutoShowAttempt = ({
  attemptedBoardId,
  attemptedViewId,
  boardHasTasks,
  cause,
  currentBoardId,
  currentViewId,
}: {
  attemptedBoardId: number | null;
  attemptedViewId: string | null;
  boardHasTasks: boolean;
  cause: EmptyStateCause | null;
  currentBoardId: number;
  currentViewId: string;
}) =>
  !boardHasTasks &&
  cause !== "empty_sections_hidden" &&
  attemptedBoardId === currentBoardId &&
  attemptedViewId === currentViewId;

export const getFilteredEmptySections = (
  sections: ISection[],
  project: IProject
) => {
  const currentSetting = getActiveEmptySectionSettingFromProject(project);
  const boardSections = project.sections?.length ? project.sections : sections;
  const boardHasTasks = boardSections.some(
    (section) => (section.items?.length ?? 0) > 0
  );

  if (currentSetting === "Hidden" && !boardHasTasks) {
    return sections.filter((section) => section.visibility);
  }

  return applyEmptySectionSetting(sections, currentSetting);
};

function applyEmptySectionSetting(
  sections: ISection[],
  setting: TBoardEmptySections
): ISection[] {
  let filteredSections: ISection[] = [];
  for (const section of sections) {
    if (setting === "Hidden") {
      if ((section.items?.length ?? 0) !== 0 && section.visibility) {
        filteredSections.push(section);
      }
    } else filteredSections.push(section);
  }

  return filteredSections;
}
