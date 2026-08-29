"use client";
import BackDropContainer from "@/components/sidebars/BackDropContainer";
import { Calendar } from "./calendar";
import { Calendar as CalendarCommon } from "@/components/Common/Calendar";
import { useCalendarContext } from "@/lib/contexts/Calendar/calendar.context";
import { calendarConfig } from "@/lib/configs/ calendar.config";
import { cn } from "@/utils/undoActions/helperFuncs";
import { X, Filter, ArrowRight } from "lucide-react";
import { lazy, Suspense, useContext, useEffect, useMemo } from "react";
import { ColoredCheckbox } from "./ColoredCheckbox";
import {
  EstimateConstants,
  PriorityConstants,
} from "@/lib/constants/constants";

import Tooltip from "@/components/Common/Tooltip";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { appShellRailAtom, calendarBoardsSidebarOpenAtom, showCommandsAtom } from "@/store";
import useClickOutside from "@/hooks/MultiPages/useClickOutside";
import { useCallback } from "react";
import Link from "next/link";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { IUser } from "@/models/model";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
// Keep the command center in the page bundle: a pull-down must mount and focus
// its input during the committing touchend, before mobile user activation ends.
import HypertasksCommands from "@/components/commands";
import MobileCalendar from "./MobileCalendar";
import { MobileBottomSheet } from "@/components/Modals/Sheets";

// React.lazy waits for an open intent before requesting these closed-only
// dialogs. next/dynamic would emit route preload hints for them at startup.
const CalendarDueDateModal = lazy(
  () => import("@/components/Modals/Calendar/calendar.modal"),
);
const CalendarManageTasksModal = lazy(
  () => import("@/components/Modals/Calendar/manage.modal"),
);
const AllFilterHTC = lazy(
  () => import("@/components/Modals/FilterModals/SelectFilters/FilterHTC"),
);

// Array of 10 different colors for checkboxes
const checkboxColors = [
  "#3b82f6", // blue-500
  "#a855f7", // purple-500
  "#ec4899", // pink-500
  "#f97316", // orange-500
  "#22c55e", // green-500
  "#06b6d4", // cyan-500
  "#eab308", // yellow-500
  "#ef4444", // red-500
  "#6366f1", // indigo-500
  "#14b8a6", // teal-500
];

const CalenderView = ({ currentUser }: { currentUser: IUser }) => {
  const { toggleShowCommands } = useHypertasksRecoilStates();
  const [showCommands] = useRecoilState(showCommandsAtom);
  const isApple = useDeviceContext();
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const {
    showDueDateModal,
    currentDate,
    handleDateSelect,
    projects,
    checkedProjects,
    handleProjectToggle,
    handleClearFilters,
    toggleDueDateModal,
    currentDay,
    showManageTasksModal,
    toggleManageTasksModal,
    getTasksForDate,
    showFilterModal,
    toggleFilterModal,
    filteredMembers,
    allAgents,
    allTags,
    taskFilters,
    isCalendarDataPending,
    calendarDataError,
    retryCalendarData,
  } = useCalendarContext();

  const [boardsSidebarOpen, setBoardsSidebarOpen] = useRecoilState(
    calendarBoardsSidebarOpenAtom
  );

  const closeBoardsSidebar = useCallback(
    () => setBoardsSidebarOpen(false),
    [setBoardsSidebarOpen]
  );
  useClickOutside(null, closeBoardsSidebar, calendarConfig.element_ids.sidebar);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);

      if (e.keyCode === KeyCodes.K && (cmdControl || e.ctrlKey)) {
        e.preventDefault();
        toggleShowCommands();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isApple, toggleShowCommands]);

  // Calculate selected count
  const selectedCount = useMemo(() => {
    return Object.values(checkedProjects).filter(Boolean).length;
  }, [checkedProjects]);

  // Check if filtering is active (project filters)
  const isFiltering = useMemo(() => {
    return selectedCount > 0 || Object.values(checkedProjects).some(Boolean);
  }, [selectedCount, checkedProjects]);

  // Active task filters for read-only display (from calendarTaskFilters)
  const activeTaskFilterLabels = useMemo(() => {
    const formatFilterValue = (values: string[]) =>
      values.length <= 2
        ? values.join(", ")
        : `${values[0]}, ${values[1]} +${values.length - 2} more`;

    const items: { label: string; value: string }[] = [];
    if (taskFilters.assignedToMe) {
      items.push({ label: "Assigned to me", value: "" });
    }
    if (taskFilters.priority?.length) {
      const names = taskFilters.priority
        .map(
          (idx) =>
            PriorityConstants.find((p) => p.priority_index === idx)
              ?.Priority_Value
        )
        .filter(Boolean) as string[];
      if (names.length) {
        items.push({ label: "Priority", value: names.join(", ") });
      }
    }
    if (taskFilters.assignees?.length && filteredMembers?.length) {
      const userNames = taskFilters.assignees
        .map(
          (id) => filteredMembers.find((u) => u.id === id)?.displayName ?? ""
        )
        .filter(Boolean);
      const agentNames = taskFilters.assigneeAgents
        .map(
          (id) => allAgents?.find((a) => a.id === id)?.displayName ?? ""
        )
        .filter(Boolean);
      const names = [...userNames, ...agentNames];
      if (names.length) {
        items.push({ label: "Assignees", value: formatFilterValue(names) });
      }
    } else if (taskFilters.assigneeAgents?.length) {
      const names = taskFilters.assigneeAgents
        .map(
          (id) => allAgents?.find((a) => a.id === id)?.displayName ?? ""
        )
        .filter(Boolean);
      if (names.length) {
        items.push({ label: "Assignees", value: formatFilterValue(names) });
      }
    }
    if (taskFilters.updatedBy?.length && filteredMembers?.length) {
      const userNames = taskFilters.updatedBy
        .map(
          (id) => filteredMembers.find((u) => u.id === id)?.displayName ?? ""
        )
        .filter(Boolean);
      const agentNames = taskFilters.updatedByAgents
        .map(
          (id) => allAgents?.find((a) => a.id === id)?.displayName ?? ""
        )
        .filter(Boolean);
      const names = [...userNames, ...agentNames];
      if (names.length) {
        items.push({ label: "Updated by", value: formatFilterValue(names) });
      }
    } else if (taskFilters.updatedByAgents?.length) {
      const names = taskFilters.updatedByAgents
        .map(
          (id) => allAgents?.find((a) => a.id === id)?.displayName ?? ""
        )
        .filter(Boolean);
      if (names.length) {
        items.push({ label: "Updated by", value: formatFilterValue(names) });
      }
    }
    if (taskFilters.createdBy?.length && filteredMembers?.length) {
      const names = taskFilters.createdBy
        .map(
          (id) => filteredMembers.find((u) => u.id === id)?.displayName ?? ""
        )
        .filter(Boolean);
      if (names.length) {
        items.push({ label: "Created by", value: formatFilterValue(names) });
      }
    }
    if (taskFilters.labels?.length && allTags?.length) {
      const names = taskFilters.labels
        .map((id) => allTags.find((l) => l.id === id)?.value)
        .filter(Boolean) as string[];
      if (names.length) {
        items.push({ label: "Labels", value: formatFilterValue(names) });
      }
    }
    if (taskFilters.size?.length) {
      const names = taskFilters.size
        .map(
          (idx) =>
            EstimateConstants.find((e) => e.estimate_index === idx)
              ?.estimate_value
        )
        .filter(Boolean) as string[];
      if (names.length) {
        items.push({ label: "Size", value: names.join(", ") });
      }
    }
    return items;
  }, [
    taskFilters.assignedToMe,
    taskFilters.priority,
    taskFilters.assignees,
    taskFilters.assigneeAgents,
    taskFilters.updatedBy,
    taskFilters.updatedByAgents,
    taskFilters.createdBy,
    taskFilters.labels,
    taskFilters.size,
    filteredMembers,
    allAgents,
    allTags,
  ]);

  const boardsFilterContent = (
    <>
      <CalendarCommon
        initialFocus={false}
        mode="single"
        defaultMonth={currentDate}
        selected={new Date()}
        onSelect={handleDateSelect}
        numberOfMonths={1}
        classNames={{
          day_selected:
            "dark:bg-[#f9f9f9] bg-[#2F343C] text-white-black-inverted rounded hover:dark:bg-[#f9f9f9] hover:bg-[#2F343C] focus:dark:bg-[#f9f9f9] focus:bg-[#2F343C]",
        }}
      />

      <div
        className="flex flex-col gap-2"
        id={calendarConfig.element_ids.projects_section}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-content font-semibold text-muted-foreground">
            Boards
          </h3>
          {isFiltering && (
            <button
              onClick={handleClearFilters}
              className="flex items-center gap-1 px-2 py-1 text-meta text-muted-foreground transition-colors hover:text-white-black"
              aria-label="Clear filters"
            >
              <X className="h-3 w-3" strokeWidth={1.75} />
              Clear filters
            </button>
          )}
        </div>
        {isCalendarDataPending ? (
          <p className="text-content text-muted-foreground">Loading boards…</p>
        ) : calendarDataError ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-content text-muted-foreground">
              Calendar data could not be loaded.
            </p>
            <button
              type="button"
              onClick={retryCalendarData}
              className="text-content font-medium text-white-black hover:underline"
            >
              Retry
            </button>
          </div>
        ) : projects.length === 0 ? (
          <p className="text-content text-muted-foreground">No boards found</p>
        ) : (
          projects.map((project, index) => {
            const isSelected = checkedProjects[project.id] ?? false;
            const projectOpacity =
              isFiltering && !isSelected ? "opacity-50" : "opacity-100";
            const projectTextColor =
              isFiltering && !isSelected
                ? "text-muted-foreground"
                : "text-white-black";
            const checkboxColor = checkboxColors[index % checkboxColors.length];

            return (
              <FilterLabel
                key={`project-${project.id}`}
                projectId={project.id}
                opacity={projectOpacity}
                checked={isSelected}
                onChange={(checked) => {
                  handleProjectToggle(project.id, checked);
                }}
                checkboxColor={checkboxColor}
                label={project.title ?? project.name}
                count={project._count?.tasks ?? 0}
                textColor={projectTextColor}
                isMobile={isMbl}
              />
            );
          })
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-content font-semibold text-muted-foreground">
            Task filters
          </h3>
          <button
            onClick={toggleFilterModal}
            className="group relative h-fit w-fit cursor-pointer"
          >
            <Filter
              size={14}
              className={`cursor-pointer ${
                activeTaskFilterLabels.length > 0
                  ? "text-[#51A4F1] font-semibold group-hover:text-blue-400"
                  : "text-white-black group-hover:text-header-hover-text"
              }`}
              strokeWidth={1.75}
            />
            <Tooltip
              left={-100}
              bottom={25}
              text="Show filter modal"
              keyCombination={["SHIFT", "F"]}
            />
          </button>
        </div>
        {activeTaskFilterLabels.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-content text-white-black">
            {activeTaskFilterLabels.map((item, i) => (
              <li
                key={`${item.label}-${i}`}
                className="flex flex-wrap items-baseline gap-1"
              >
                <span className="shrink-0 font-medium text-muted-foreground">
                  {item.label}
                  {item.value ? ": " : ""}
                </span>
                {item.value ? <span className="truncate">{item.value}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-content text-muted-foreground">
            No active filters. Press Shift + F to toggle filter modal.
          </p>
        )}
      </div>
    </>
  );

  return (
    <>
      {appShellRailOn && (
        <AppShellRail variant="global" currentUser={currentUser} />
      )}
      {calendarDataError ? (
        <main
          className={cn(
            "flex min-h-[60vh] flex-1 items-center justify-center px-6",
            appShellRailOn && "pl-[calc(var(--app-shell-rail-w,48px)+1.5rem)]",
          )}
          role="alert"
        >
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <p className="text-body font-medium text-white-black">
              Calendar data could not be loaded.
            </p>
            <p className="text-content text-muted-foreground">
              Check your connection, then try again.
            </p>
            <button
              type="button"
              onClick={retryCalendarData}
              className="rounded-md bg-white-black px-4 py-2 text-content font-medium text-containerBackground"
            >
              Retry
            </button>
          </div>
        </main>
      ) : isMbl ? (
        <MobileCalendar />
      ) : appShellRailOn ? (
        <div className="pl-[var(--app-shell-rail-w,48px)]"><Calendar /></div>
      ) : (
        <Calendar />
      )}
      {boardsSidebarOpen &&
        (isMbl ? (
          <MobileBottomSheet
            onClose={closeBoardsSidebar}
            ariaLabel="Calendar board filters"
          >
            <div
              id={calendarConfig.element_ids.sidebar}
              className="flex flex-col gap-4 px-4 pb-[env(safe-area-inset-bottom)] text-white-black"
            >
              {boardsFilterContent}
            </div>
          </MobileBottomSheet>
        ) : (
          <BackDropContainer className="!z-[250]">
            <div
              style={{ zIndex: "999998" }}
              id={calendarConfig.element_ids.sidebar}
              className="fixed left-0 top-0 flex h-SVH-full w-[90%] flex-col gap-4 overflow-y-auto bg-sidebar pt-[max(1rem,env(safe-area-inset-top))] pb-4 pl-8 pr-7 text-white-black sm:w-[384px]"
            >
              {boardsFilterContent}
            </div>
          </BackDropContainer>
        ))}
      <Suspense fallback={null}>
        {showDueDateModal?.show && (
          <CalendarDueDateModal
            mode={showDueDateModal?.mode}
            callbackHandler={toggleDueDateModal}
            currentDay={currentDay}
            selectedTask={showDueDateModal?.selectedTask}
          />
        )}
        {showManageTasksModal?.show && (
          <CalendarManageTasksModal
            tasks={getTasksForDate(showManageTasksModal.date)}
            date={showManageTasksModal.date}
            toggle={toggleManageTasksModal}
          />
        )}
        {showFilterModal && (
          <AllFilterHTC
            toggle={toggleFilterModal}
            view="Calendar"
            filteredMembers={filteredMembers}
            allTags={allTags}
          />
        )}
      </Suspense>
      {showCommands.show && <HypertasksCommands />}
    </>
  );
};

const FilterLabel = ({
  projectId,
  opacity,
  checked,
  onChange,
  checkboxColor,
  label,
  count,
  textColor,
  isMobile,
}: {
  projectId: number;
  opacity: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  checkboxColor: string;
  label: string;
  count: number;
  textColor: string;
  isMobile: boolean;
}) => {
  return (
    <label
      className={cn(
        isMobile
          ? "group flex min-h-[52px] cursor-pointer items-center gap-2 border-b border-light-black-border-1 transition-opacity"
          : "group flex cursor-pointer items-center gap-2 rounded transition-opacity hover:bg-muted/50",
        opacity
      )}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <ColoredCheckbox
        checked={checked}
        onChange={(checked) => {
          // onChange(checked);
        }}
        color={checkboxColor}
        id={label}
      />
      <span className={cn("text-content truncate min-w-0", textColor)}>{label}</span>
      <Link
        href={`/project?id=${projectId}`}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 text-muted-foreground hover:text-white-black transition-colors"
        aria-label={`Open ${label} board`}
      >
        <ArrowRight size={10}  strokeWidth={1.75}/>
      </Link>
      <span className={cn("text-meta shrink-0 ml-auto", textColor)}>({count})</span>
    </label>
  );
};
export default CalenderView;
