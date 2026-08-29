"use client";
import { useCalendarView } from "@/hooks/Calendar/useCalendarView";
import { useCalendarRealtime } from "@/hooks/realtime/useCalendarRealtime";
import { IAgent, ILabel, ITask, IUser } from "@/models/model";
import type {
  CalendarLabelSummary,
  CalendarProjectV1,
  CalendarUserSummary,
} from "@/lib/calendarSync/contract";
import {
  createContext,
  Dispatch,
  ReactNode,
  SetStateAction,
  useContext,
  useMemo,
} from "react";
import { DropResult } from "@hello-pangea/dnd";
import type {
  CalendarSavedView,
  CalendarSort,
  CalendarTaskFilters,
} from "@/models/Calendar/model";
import type { ViewVisibility } from "@prisma/client";

interface IContextProps {
  currentDate: Date;
  currentView: "month" | "week" | "day";
  currentDay: Date;
  currentTask: number;
  weeks: Date[][];
  tasks: ITask[];
  projects: CalendarProjectV1[];
  checkedProjects: Record<number, boolean>;
  taskFilters: CalendarTaskFilters;
  calendarSort: CalendarSort | null;
  calendarViews: CalendarSavedView[];
  appliedCalendarViewId: string | null;
  everythingTitle: string;
  calendarViewCounts: Map<string, number>;
  visibleTaskCount: number;
  isCalendarDataPending: boolean;
  calendarDataError: boolean;
  retryCalendarData: () => void;
  isCalendarViewDirty: boolean;
  showDueDateModal:
    | {
        show: boolean;
        mode: "Create" | "Update";
        selectedTask?: ITask;
      }
    | undefined;
  showManageTasksModal: { show: boolean; date: Date } | undefined;
  showFilterModal: boolean;
  filteredMembers: CalendarUserSummary[];
  allAgents: IAgent[];
  allTags: CalendarLabelSummary[];
  toggleFilterModal: () => void;
  setCalendarSort: Dispatch<SetStateAction<CalendarSort | null>>;
  applyCalendarView: (viewId: string | null) => Promise<void>;
  saveCalendarView: (
    title: string,
    updateApplied: boolean,
    visibility: ViewVisibility,
  ) => Promise<boolean>;
  renameCalendarView: (viewId: string, title: string) => Promise<boolean>;
  renameEverything: (title: string) => Promise<boolean>;
  deleteCalendarView: (viewId: string) => Promise<boolean>;
  resetEverything: () => Promise<boolean>;
  resetCalendarView: () => void;
  getTasksForDate: (date: Date) => ITask[];
  onDragEnd: (result: DropResult) => Promise<void>;
  onTaskUpdate: (task: ITask, updates: Partial<ITask>) => void;
  handlePrevious: () => void;
  handleNext: () => void;
  setCurrentView: Dispatch<SetStateAction<"month" | "week" | "day">>;
  setCurrentTask: Dispatch<SetStateAction<number>>;
  handleDateSelect: (date: Date | undefined) => void;
  handleProjectToggle: (projectId: number, checked: boolean) => void;
  handleTaskFilterToggle: (
    filterName:
      | "assignees"
      | "assigneeAgents"
      | "updatedByAgents"
      | "priority"
      | "assignedToMe"
      | "updatedBy"
      | "createdBy"
      | "labels"
      | "size",
    checked: boolean,
  ) => void;
  handleClearFilters: () => void;
  handleTaskClick: (taskDay: Date, task: ITask) => void;
  dueDateModalCallback: (date: Date | undefined) => void;
  toggleDueDateModal(
    mode?: "Create" | "Update",
    payload?: {
      task?: ITask;
      date: Date | undefined;
    },
  ): void;
  setCurrentDate: (date: Date) => void;
  toggleManageTasksModal: (
    date: Date,
    close?: boolean,
    mode?: "Add" | "Update" | "Visit",
    task?: ITask,
  ) => void;
}

const CalendarContext = createContext<IContextProps | undefined>(undefined);

export const CalendarProvider = ({
  children,
  accountId,
}: {
  children: ReactNode;
  accountId: number;
}) => {
  const contextProps = useCalendarView(accountId);
  const projectIds = useMemo(
    () => contextProps.projects.map((project) => project.id),
    [contextProps.projects],
  );
  useCalendarRealtime(accountId, projectIds, contextProps.reconcileCalendar);

  return (
    <CalendarContext.Provider
      value={{
        ...contextProps,
      }}
    >
      {children}
    </CalendarContext.Provider>
  );
};

export const useCalendarContext = (): IContextProps => {
  const context = useContext(CalendarContext);
  if (context === undefined) {
    throw new Error(
      "useCalendarContext must be used within a CalendarProvider",
    );
  }
  return context;
};
