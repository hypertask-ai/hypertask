import { useGetAllMembersForAssign } from "@/hooks/MultiPages/useGetMembersForAssignees";
import { IAgent, IUser } from "@/models/model";
import { calendarTaskFiltersAtom, currentProjectAtom } from "@/store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRecoilValue } from "@/lib/state";
import { getActiveFiltersFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { useAgents } from "@/hooks/MultiPages/useAgents";
import type { CalendarUserSummary } from "@/lib/calendarSync/contract";

type AssigneeOption = IUser | CalendarUserSummary | IAgent;

interface IProps {
  closeHandler: (param?: AssigneeOption) => Promise<void>;
  calendarAssignees?: CalendarUserSummary[];
  view: "Kanban" | "Calendar";
}

export const useAssigneeFilter = ({
  closeHandler,
  calendarAssignees,
  view,
}: IProps) => {
  const [keyword, setKeyword] = useState("");
  const currentProject = useRecoilValue(currentProjectAtom);
  const { data: membersAndOwner } = useGetAllMembersForAssign(
    ["assign", currentProject?.id],
    currentProject?.id!,
  );
  const { allAgents } = useAgents();
  const [unFiltered, setUnfiltered] = useState<AssigneeOption[]>([]);
  const [filteredAssignees, setFilteredAssignees] = useState<AssigneeOption[]>(
    [],
  );
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const filterCommandsLen = useMemo(
    () => filteredAssignees.length,
    [filteredAssignees],
  );
  const calendarTaskFilters = useRecoilValue(calendarTaskFiltersAtom);

  const activeFilters = getActiveFiltersFromProject(
    currentProject,
  ).addedFilters.find((x) => x.type === "Assignees");

  const activeFiltersFlatMap = useMemo(() => {
    if (view === "Calendar") {
      return [
        ...calendarTaskFilters.assignees,
        ...calendarTaskFilters.assigneeAgents,
      ];
    }
    return (
      activeFilters?.searchPayload.flatMap(
        (x: { id: number | string }) => x.id,
      ) ?? []
    );
  }, [
    view,
    calendarTaskFilters.assignees,
    calendarTaskFilters.assigneeAgents,
    activeFilters,
  ]);

  const assigneeSource = useMemo(() => {
    const uniqueUsersMap = new Map<number, IUser | CalendarUserSummary>();
    const uniqueAgentsMap = new Map<string, IAgent>();

    if (view === "Calendar" && calendarAssignees?.length) {
      for (const user of calendarAssignees) {
        if (user) uniqueUsersMap.set(user.id, user);
      }
    } else if (view === "Kanban" && membersAndOwner) {
      const members: IUser[] =
        membersAndOwner.members?.map(({ user }: { user: IUser }) => user) || [];
      const owner = membersAndOwner.owner;
      for (const user of members) {
        if (user) uniqueUsersMap.set(user.id, user);
      }
      if (owner) uniqueUsersMap.set(owner.id, owner);
    }

    for (const agent of allAgents ?? []) {
      if (agent && !agent.revokedAt && !uniqueAgentsMap.has(agent.id)) {
        uniqueAgentsMap.set(agent.id, agent);
      }
    }

    return [
      ...Array.from(uniqueUsersMap.values()),
      ...Array.from(uniqueAgentsMap.values()),
    ];
  }, [view, calendarAssignees, membersAndOwner, allAgents]);

  const filterData = (keyword: string) => {
    setFilteredAssignees(() =>
      unFiltered.filter((filterCommand) =>
        keyword
          ? filterCommand.displayName
              ?.toLowerCase()
              .includes(keyword.toLowerCase())
          : true,
      ),
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
      const selectedIdx =
        (selectedIndex + filterCommandsLen - 1) % filterCommandsLen;
      handleCommandSelect(selectedIdx);
    }

    if (event.keyCode === KeyCodes.ARROW_DOWN) {
      if (selectedIndex === filterCommandsLen - 1) return;
      const selectedIdx = (selectedIndex + 1) % filterCommandsLen;
      handleCommandSelect(selectedIdx);
    }

    if (event.keyCode === KeyCodes.ENTER) {
      event.preventDefault();
      enterHandler(selectedIndex);
    }
  };

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, filteredAssignees, filterCommandsLen, membersAndOwner]);

  const enterHandler = (index: number) =>
    closeHandler(filteredAssignees[index]);

  // HTPR-5089: the people already used by the filter belong at the top, same
  // as the tag picker. Snapshot the selection when the modal mounts rather
  // than tracking activeFiltersFlatMap: sorting off the live value would
  // reorder rows under the cursor every time you toggle someone.
  // Seed on the first render that actually has a selection: on mount the
  // project may still be loading, and an empty seed would never sort anything.
  // Once seeded it never changes, which is what keeps rows still on toggle.
  const selectedOnOpenRef = useRef<Set<number | string>>(new Set());
  if (!selectedOnOpenRef.current.size && activeFiltersFlatMap.length) {
    selectedOnOpenRef.current = new Set(activeFiltersFlatMap);
  }

  const sortSelectedFirst = useCallback((people: AssigneeOption[]) => {
    const selected = selectedOnOpenRef.current;
    if (!selected.size) return people;
    return [...people].sort(
      (a, b) => (selected.has(a.id) ? 0 : 1) - (selected.has(b.id) ? 0 : 1),
    );
  }, []);

  useEffect(() => {
    const ordered = sortSelectedFirst(assigneeSource);
    setUnfiltered(ordered);
    setFilteredAssignees(
      keyword
        ? ordered.filter((u) =>
            u.displayName?.toLowerCase().includes(keyword.toLowerCase()),
          )
        : ordered,
    );
  }, [assigneeSource, keyword, sortSelectedFirst]);

  return {
    onKeyChange,
    keyword,
    filteredAssignees,
    selectedIndex,
    setSelectedIndex,
    enterHandler,
    activeFiltersFlatMap,
  };
};
