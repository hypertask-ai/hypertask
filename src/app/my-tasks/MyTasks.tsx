"use client";

import BackButton from "@/components/Buttons/BackButton";
import { SplitTitle } from "@/components/Common/TaskRowComponents/TaskListRow";
import PriorityLabelComponent from "@/components/Modals/TaskPriority/PriorityLabelComponent";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import TableView from "@/components/PageComponents/Kanban/TableView/TableView";
import useClickOutside from "@/hooks/MultiPages/useClickOutside";
import { useFlag } from "@/hooks/useFlag";
import { MY_TASKS_PRIORITY_FILTER_FLAG } from "@/lib/flags/keys";
import { PriorityConstants, type IPrioritiesConstants } from "@/lib/constants/constants";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useRecoilValue } from "@/lib/state";
import { filterMyTasksByPriority } from "@/lib/myTasksFiltering";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import { ISection, IUser } from "@/models/model";
import type { TBoardSortingViewMode } from "@/models/Views/model";
import { appShellRailAtom, showCommandsAtom } from "@/store";
import styles from "@/styles/search.module.scss";
import { useRouter } from "next/navigation";
import { Check, Filter } from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

interface IProps {
  sections: ISection[];
  tabs: string[];
  currentUser: IUser;
}

const MY_TASKS_SORTING_MODE = "DueDate" as TBoardSortingViewMode;

const MyTasks = ({ sections, tabs, currentUser }: IProps) => {
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const showCommands = useRecoilValue(showCommandsAtom);
  const [activeSplit, setActiveSplit] = useState(0);
  const router = useRouter();

  const filterEnabled = useFlag(MY_TASKS_PRIORITY_FILTER_FLAG);
  // My Tasks spans every board, so unlike board filters (which persist to a
  // saved view) this selection lives in state only and resets on reload.
  const [prioritySelection, setPrioritySelection] = useState<
    IPrioritiesConstants[]
  >([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  useClickOutside(filterRef, () => setFilterOpen(false));

  // One gate for both control and behavior: if the flag flips off while a
  // selection exists, filtering stops too instead of hiding the control.
  const selectedPriorities = filterEnabled ? prioritySelection : [];
  const filteredSections = useMemo(
    () => filterMyTasksByPriority(sections, selectedPriorities),
    [sections, selectedPriorities]
  );

  const totalCount = useMemo(
    () =>
      filteredSections.reduce((total, section) => total + section.items.length, 0),
    [filteredSections]
  );
  const visibleSections = useMemo(() => {
    if (activeSplit === 0) return filteredSections;
    const active = filteredSections[activeSplit - 1];
    return active ? [active] : [];
  }, [activeSplit, filteredSections]);

  const updateSplit = useCallback(
    (index: number) => {
      setActiveSplit(Math.max(0, Math.min(index, tabs.length - 1)));
    },
    [tabs.length]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !showCommands.show && !returnIfModalOrInputActive()) {
        event.preventDefault();
        if (filterOpen) {
          setFilterOpen(false);
          return;
        }
        router.back();
        return;
      }
      if (
        event.key !== "Tab" ||
        tabs.length === 0 ||
        returnIfModalOrInputActive()
      )
        return;

      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      updateSplit((activeSplit + direction + tabs.length) % tabs.length);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeSplit, router, showCommands.show, tabs.length, updateSplit, filterOpen]);

  const tabLength = (index: number) =>
    index === 0 ? totalCount : filteredSections[index - 1]?.items.length ?? 0;

  const togglePriority = (priority: IPrioritiesConstants) =>
    setPrioritySelection((current) =>
      current.some((p) => p.priority_index === priority.priority_index)
        ? current.filter((p) => p.priority_index !== priority.priority_index)
        : [...current, priority]
    );

  const splitTitles = tabs.map((item, index) => (
    <SplitTitle
      key={`split-my-tasks-${index}`}
      isSelected={activeSplit === index}
      onClick={() => updateSplit(index)}
      tab={{
        idx: index,
        project: item,
        length: tabLength(index),
        hasUnseen: false,
      }}
    />
  ));

  const content = (
    <div
      suppressHydrationWarning
      className={`py-9 h-screen min-h-0 overflow-hidden bg-containerBackground flex-col rounded-[4px] my-0 global-view-width flex linksModal ${styles.links_modal}`}
    >
      <div className="flex gap-5 px-[16px] @md:!px-[88px]">
        <span className="flex items-baseline gap-2 font-bold text-subheading text-white-black">
          <p>My Tasks</p>
          <span className="text-content font-normal text-text-light-gray">
            {totalCount}
          </span>
        </span>
        {filterEnabled && (
          <div ref={filterRef} className="relative ml-auto self-center">
            <button
              id="my-tasks-priority-filter"
              type="button"
              aria-haspopup="menu"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((open) => !open)}
              className={`${isMbl ? MOBILE_TARGET : "inline-flex h-7 items-center"} gap-1 rounded-[4px] border-0 px-2 text-content text-text-light-gray transition-colors hover:bg-hover-active hover:text-white-black focus-visible:bg-hover-active focus-visible:outline-none`}
            >
              <Filter size={14} strokeWidth={1.75} />
              <span className="sr-only">Filter by priority</span>
              {selectedPriorities.length > 0 && (
                <span className="text-meta font-medium" aria-hidden="true">{selectedPriorities.length}</span>
              )}
            </button>
            {filterOpen && (
              <div
                role="menu"
                aria-label="Priority filter"
                className="absolute right-0 top-full z-30 mt-1 min-w-[170px] rounded-[5px] bg-modalBackground py-1 shadow-md"
              >
                {PriorityConstants.map((priority) => {
                  const checked = selectedPriorities.some(
                    (p) => p.priority_index === priority.priority_index
                  );
                  return (
                    <button
                      key={`priority-filter-${priority.priority_index}`}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={checked}
                      onClick={() => togglePriority(priority)}
                      className="flex w-full items-center gap-3 px-2 py-1.5 text-left transition-colors hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none"
                    >
                      <span className="flex-grow">
                        <PriorityLabelComponent priority={priority} />
                      </span>
                      {checked && <Check size={16} strokeWidth={1.75} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="hidden @md:block w-full overflow-x-auto scrollbar-none no-scrollbar @md:px-[78px] @lg:px-[73px] mt-4">
        <div className="flex flex-wrap grow">{splitTitles}</div>
      </div>

      <div className="mt-3 flex-1 min-h-0 w-full">
        <TableView
          filteredSections={visibleSections}
          _sections={visibleSections}
          _currentProject={null}
          _activeSortingMode={MY_TASKS_SORTING_MODE}
          currentUser={currentUser}
        />
      </div>

      <div className="flex inbox_footer @md:hidden no-scrollbar scrollbar-none @md:gap-8 w-100 bg-hoverCardBackground h-20 @md:h-8 inbox_title">
        {splitTitles}
      </div>
    </div>
  );

  return (
    <>
      {appShellRailOn && (
        <AppShellRail variant="global" currentUser={currentUser} />
      )}
      {appShellRailOn ? (
        <div className="pl-[var(--app-shell-rail-w,48px)]">{content}</div>
      ) : (
        content
      )}
      <BackButton left={appShellRailOn ? 56 : undefined} />
    </>
  );
};

export default MyTasks;
