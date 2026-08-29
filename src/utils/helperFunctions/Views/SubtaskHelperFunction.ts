import { IProject, ISection } from "@/models/model";
import {
  DEFAULT_SUBTASK_SETTING,
  TBoardSubtaskSetting,
} from "@/models/Views/model";
import { getActiveSubtaskSettingFromProject } from "./ViewsHelperFunctions";

export const defaultSubtaskSettings: TBoardSubtaskSetting =
  DEFAULT_SUBTASK_SETTING;

export const getAppliedSubtaskSections = (
  sections: ISection[],
  project: IProject
) => {
  const currentSetting = getActiveSubtaskSettingFromProject(project);

  return applySubTaskSetting(sections, currentSetting);
};

export function applySubTaskSetting(
  sections: ISection[],
  setting: TBoardSubtaskSetting
): ISection[] {
  const filteredSections = sections.map((section) => {
    const items = section.items ?? [];
    if (setting === "None") {
      return {
        ...section,
        items: items.filter((item) => !item.parentTask),
      };
    } else if (setting === "Card") {
      return {
        ...section,
        items: items.filter(
          (item) =>
            !item.parentTask || (item.subTasks && item.subTasks.length > 0)
        ),
      };
    } else if (setting === "Parent") {
      return {
        ...section,
        items: items.filter((item) => !item.parentTask),
      };
    }
    return section;
  });

  return filteredSections;
}
