import { IProject, ISection } from "@/models/model";
import { TBoardEmptySections } from "@/models/Views/model";
import { getActiveEmptySectionSettingFromProject } from "./ViewsHelperFunctions";

export const defaultEmptySections: TBoardEmptySections = "Show";

export const getFilteredEmptySections = (
  sections: ISection[],
  project: IProject,
  showEmptyViewColumns = false,
) => {
  const currentSetting = getActiveEmptySectionSettingFromProject(project);
  return applyEmptySectionSetting(sections, currentSetting, showEmptyViewColumns);
};

function applyEmptySectionSetting(
  sections: ISection[],
  setting: TBoardEmptySections,
  showEmptyViewColumns: boolean,
): ISection[] {
  if (setting === "Hidden" && showEmptyViewColumns &&
      !sections.some((section) => section.visibility && (section.items?.length ?? 0) > 0)) {
    return sections.filter((section) => section.visibility);
  }

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
