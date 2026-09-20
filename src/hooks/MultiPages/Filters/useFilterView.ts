/* eslint-disable react/jsx-key */
import { FilterCommandMode } from "@/models/Filters/enums";
import { IFilterCommandList, TFilter } from "@/models/Filters/model";
import { useRecoilValue } from "@/lib/state";
import { calendarTaskFiltersAtom, currentProjectAtom } from "@/store";
import { getActiveFiltersFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { useCallback, useEffect, useMemo, useState } from "react";
import { filterCommandLists } from "@/components/Modals/FilterModals/SelectFilters/FilterOptions";
import { useMyTasksFilterController } from "@/lib/myTasksFilterContext";

export const useFilterView = (view: "Kanban" | "Calendar" | "MyTasks") => {
  const [keyword, setKeyword] = useState("");
  const currentProject = useRecoilValue(currentProjectAtom);
  const calendarTaskFilters = useRecoilValue(calendarTaskFiltersAtom);
  const myTasksFilters = useMyTasksFilterController();
  const projectActiveFilters = getActiveFiltersFromProject(currentProject);
  const activeFilters = useMemo(() => {
    if (view === "Calendar") {
      return { ...projectActiveFilters, matchFilters: calendarTaskFilters.matchFilters };
    }
    if (view === "MyTasks") {
      return myTasksFilters?.activeFilters ?? {
        matchFilters: "ANY" as const,
        addedFilters: [],
      };
    }
    return projectActiveFilters;
  }, [
    view,
    projectActiveFilters,
    calendarTaskFilters.matchFilters,
    myTasksFilters?.activeFilters,
  ]);
  const addedFiltersFlat = activeFilters.addedFilters.flatMap((x) => x.type);

  const excludedCommandModes = [
    FilterCommandMode.DueDate,
    FilterCommandMode.InInbox,
    FilterCommandMode.Unread,
    FilterCommandMode.CreatedAt,
    FilterCommandMode.UpdatedRange,
    FilterCommandMode.ToggleMatchCriterai,
    FilterCommandMode.BlockedByPerson,
    FilterCommandMode.NoRecentComment,
    FilterCommandMode.StuckInColumn,
    FilterCommandMode.RunningTimer,
    FilterCommandMode.StaleOnBoard,
    FilterCommandMode.NotStale,
  ];

  const calendarFilterList = useMemo(
    () =>
      filterCommandLists.filter(
        (x) => !excludedCommandModes.includes(x.commandMode)
      ),
    []
  );

  const myTasksFilterList = useMemo(
    () => [
      ...filterCommandLists,
      ...(myTasksFilters?.scopePanel
        ? [{
            key: "myTasksScope",
            name: "Boards, columns, and status",
            type: FilterCommandMode.MyTasksScope,
            commandMode: FilterCommandMode.MyTasksScope,
          }]
        : []),
      ...(myTasksFilters?.involvementEnabled
        ? [{
            key: "involvement",
            name: "Involvement",
            type: FilterCommandMode.Involvement,
            commandMode: FilterCommandMode.Involvement,
          }]
        : []),
    ],
    [myTasksFilters?.involvementEnabled, myTasksFilters?.scopePanel],
  );
  let sourceList = filterCommandLists;
  if (view === "Calendar") sourceList = calendarFilterList;
  if (view === "MyTasks") sourceList = myTasksFilterList;
  const hasInvolvementFilter = Boolean(
    view === "MyTasks" &&
      myTasksFilters?.involvementEnabled &&
      !(myTasksFilters.scopes.length === 1 && myTasksFilters.scopes[0] === "assigned"),
  );
  const hasScopeFilter = Boolean(
    view === "MyTasks" && myTasksFilters?.scopeFilterCount,
  );

  const reOrder = useCallback(
    (activeFilters: TFilter[]) => {
      if (view === "Calendar") {
        const calendarHasFilters = Object.entries(calendarTaskFilters).some(
          ([key, value]) => {
            if (key === "matchFilters") return false;
            if (Array.isArray(value)) return value.length > 0;
            return !!value;
          }
        );
        if (!calendarHasFilters) {
          return calendarFilterList.filter(
            (cmd) =>
              cmd.commandMode !== FilterCommandMode.ClearAll &&
              cmd.commandMode !== FilterCommandMode.ToggleMatchCriterai
          );
        }
        return calendarFilterList;
      }
      if (activeFilters.length === 0 && !hasInvolvementFilter && !hasScopeFilter) {
        return sourceList.filter(
          (x) =>
            x.type !== FilterCommandMode.ClearAll &&
            x.type !== FilterCommandMode.ToggleMatchCriterai
        );
      }

      const clearAll = sourceList.find(
        (x) => x.commandMode === FilterCommandMode.ClearAll
      );
      const withoutClearAll = sourceList.filter(
        (x) =>
          x.type !== FilterCommandMode.ClearAll &&
          x.type !== FilterCommandMode.ToggleMatchCriterai
      );

      const applied = withoutClearAll.sort((a, b) => {
        if (a.commandMode === FilterCommandMode.ClearAll) return 1;
        if (b.commandMode === FilterCommandMode.ShowAllFilters) return 1;
        if (activeFilters.includes(a.type as TFilter)) return -1;
        if (activeFilters.includes(b.type as TFilter)) return 1;
        return a.name.localeCompare(b.name);
      });
      return clearAll ? [clearAll, ...applied] : applied;
    },
    [
      view,
      calendarFilterList,
      sourceList,
      calendarTaskFilters,
      hasInvolvementFilter,
      hasScopeFilter,
    ]
  );

  const [filteredCommands, setFilteredCommands] = useState<IFilterCommandList[]>(
    () => reOrder(addedFiltersFlat)
  );
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const filterCommandsLen = useMemo(
    () => filteredCommands.length,
    [filteredCommands]
  );

  const filterData = (keyword: string) => {
    setFilteredCommands(() =>
      keyword
        ? sourceList.filter((filterCommand) =>
            filterCommand.name
              ?.toLowerCase()
              .includes(keyword.toLowerCase())
          )
        : reOrder(addedFiltersFlat)
    );
  };

  const onKeyChange = (e: any) => {
    setKeyword(e.target.value);
    filterData(e.target.value);
    handleCommandSelect(0);
  };

  const handleCommandSelect = (commandIndex: number) => {
    setSelectedIndex(commandIndex);
    document
      .getElementById(`filter-htc-option-${commandIndex}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.keyCode === KeyCodes.ARROW_UP) {
      if (selectedIndex === 0) return;
      const selectedIdx = selectedIndex - 1;
      handleCommandSelect(selectedIdx);
    }

    if (event.keyCode === KeyCodes.ARROW_DOWN) {
      if (selectedIndex === filterCommandsLen - 1) return;
      const selectedIdx = selectedIndex + 1;
      handleCommandSelect(selectedIdx);
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, filteredCommands, filterCommandsLen]);

  return {
    onKeyChange,
    keyword,
    filteredCommands,
    selectedIndex,
    setSelectedIndex,
    activeFilters,
  };
};
