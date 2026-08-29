/* eslint-disable react-hooks/exhaustive-deps */
import { useGetAllProjectLabels } from "@/hooks/MultiPages/useGetAllProjectLabels";
import { ILabel } from "@/models/model";
import {
  calendarTaskFiltersAtom,
  currentProjectAtom,
  inViewObjectAtom,
} from "@/store";
import { useRecoilValue } from "@/lib/state";
import { deepCopy } from "@/utils/helperFunctions/helperFunctions";
import { useMemo, useState, useEffect, useCallback } from "react";
import { IFilter } from "@/models/Filters/model";
import { getActiveFiltersFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { sortLabels } from "@/utils/helperFunctions/Views/FilterHelperFunctions";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import type { CalendarLabelSummary } from "@/lib/calendarSync/contract";

type CalendarLabelOption = ILabel | CalendarLabelSummary;

export const useTagsModal = (
  closeHandler: (label?: CalendarLabelOption) => Promise<void>,
  view: "Kanban" | "Calendar",
  calendarTags?: CalendarLabelSummary[],
) => {
  const [keyword, setKeyword] = useState("");
  const inViewObject = useRecoilValue(inViewObjectAtom);
  const calendarTaskFilters = useRecoilValue(calendarTaskFiltersAtom);
  const currentProject = useRecoilValue(currentProjectAtom);
  // HTPR-4878: this is the BOARD's tag filter, so it must load the board's
  // labels. It used to read inViewObject.taskProjectId, which is the focused
  // task, so on a freshly loaded board with nothing focused the query ran with
  // no project id and the picker rendered zero rows. Fall back to the focused
  // task only when there is no current project.
  const { data: labelsFromTQ } = useGetAllProjectLabels(
    currentProject?.id ?? inViewObject.taskProjectId,
  );

  const projectCurrentlyActive = getActiveFiltersFromProject(
    currentProject,
  ).addedFilters.find((filter) => filter.type === "Labels");

  const labelSource = useMemo(() => {
    if (view === "Calendar") return calendarTags ?? [];
    return labelsFromTQ ?? [];
  }, [calendarTags, labelsFromTQ, view]);

  const activeForSort = useMemo((): IFilter | ILabel[] => {
    if (view === "Calendar") {
      return {
        type: "Labels",
        searchPayload: calendarTaskFilters.labels.map((id) => ({ id })),
        condition: () => false,
      };
    }
    return projectCurrentlyActive ?? [];
  }, [view, calendarTaskFilters.labels, projectCurrentlyActive]);

  const sortedLabelsFn = useCallback(
    (x: any[], y: IFilter | ILabel[], z: boolean) => sortLabels(x, y, z),
    [],
  );

  const [filteredLabels, setFilteredCommands] = useState<CalendarLabelOption[]>(
    () => sortedLabelsFn(deepCopy(labelSource), activeForSort, true),
  );
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const filterData = useCallback(
    (kw: string) => {
      // HTPR-5089: sort here too. Without it, the tags already used by the
      // filter jump back into alphabetical order the moment you type, so the
      // most relevant ones scroll out of reach. reSort deliberately keeps
      // sort=false so a tag does not leap to the top under the cursor the
      // instant you check it.
      const updatedLabels = sortedLabelsFn(
        deepCopy(labelSource),
        activeForSort,
        true,
      ).filter((filterCommand) =>
        kw
          ? filterCommand.value?.toLowerCase().includes(kw.toLowerCase())
          : true,
      );
      setFilteredCommands(updatedLabels);
      return updatedLabels;
    },
    [
      labelSource,
      activeForSort,
      sortedLabelsFn,
      calendarTaskFilters.labels,
      view,
    ],
  );

  const reSort = useCallback(() => {
    const active =
      view === "Calendar"
        ? activeForSort
        : (getActiveFiltersFromProject(currentProject).addedFilters.find(
            (f) => f.type === "Labels",
          ) ?? []);
    const newSorted = sortedLabelsFn(deepCopy(labelSource), active, false);
    setFilteredCommands(newSorted);
  }, [view, labelSource, activeForSort, currentProject, sortedLabelsFn]);

  const onKeyChange = (e: any) => {
    setKeyword(e.target.value);
    filterData(e.target.value);
    handleCommandSelect(0);
  };

  const handleCommandSelect = (commandIndex: number) => {
    setSelectedIndex(commandIndex);
    document
      .getElementById(`label-htc-option-${commandIndex}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.keyCode === KeyCodes.ARROW_UP) {
      if (selectedIndex === 0) return;
      const selectedIdx =
        (selectedIndex + filteredLabels.length - 1) % filteredLabels.length;
      handleCommandSelect(selectedIdx);
    }

    if (event.keyCode === KeyCodes.ARROW_DOWN) {
      if (selectedIndex === filteredLabels.length - 1) return;
      const selectedIdx = (selectedIndex + 1) % filteredLabels.length;
      handleCommandSelect(selectedIdx);
    }
    if (event.keyCode === KeyCodes.ENTER) {
      event.preventDefault();
      enterHandler(selectedIndex);
    }
  };

  const enterHandler = async (index: number) => {
    const selectedLabel = filteredLabels[index];
    await closeHandler(selectedLabel);
    setTimeout(() => reSort(), 100);
  };

  useEffect(() => {
    setFilteredCommands(filterData(keyword));
  }, [
    activeForSort,
    labelSource,
    keyword,
    calendarTaskFilters.labels,
    filterData,
  ]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, filteredLabels, activeForSort]);

  return {
    onKeyChange,
    keyword,
    filteredLabels,
    selectedIndex,
    setSelectedIndex,
    enterHandler,
  };
};
