import { IProject, ISection } from "@/models/model";
import { TBoardEmptySections } from "@/models/Views/model";
import { getActiveEmptySectionSettingFromProject } from "./ViewsHelperFunctions";

export const defaultEmptySections: TBoardEmptySections = "Show";

export const getFilteredEmptySections = (
  sections: ISection[],
  project: IProject
) => {
  const currentSetting = getActiveEmptySectionSettingFromProject(project);
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
