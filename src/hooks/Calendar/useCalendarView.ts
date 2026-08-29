import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { IAgent, ILabel, IProject, ITask } from "@/models/model";
import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DropResult } from "@hello-pangea/dnd";
import toast from "react-hot-toast";
import UpdateKanban from "../MultiPages/useUpdateTaskInBoards";
import {
  getFirstDayOfMonth,
  getLastDayOfMonth,
  getWeekStartIndex,
  startOfWeek,
  addMonths,
  subtractMonths,
  addDays,
  subtractDays,
  isTaskAssignedToMe,
  isSameDate,
} from "@/utils/helperFunctions/calendar.functions";
import { useProjectQuery } from "../General/useProjectQuery";
import { useSetRecoilState, useRecoilValue, useRecoilState } from "@/lib/state";
import { tasksPlayListAtom, showCreateTaskModalAtom, currentViewAtom, calendarCheckedProjectsAtom, calendarTaskFiltersAtom, calendarSettingsAtom, calendarSortAtom } from "@/store";
import useGetTimeOptions from "../General/useGetTimeOptions";
import { isToday, startOfDay } from "date-fns";
import { useRouter } from "next/navigation";
import globalConstants from "@/lib/constants";
import { calendarConfig } from "@/lib/configs/ calendar.config";
import { keyboard_shortcuts as ks, matchesShortcut } from "@/lib/utils/keyboardShortcuts";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import {
  buildSortComparator,
  returnIfModalOrInputActive,
} from "@/utils/helperFunctions/helperFunctions";
import { useAgents } from "@/hooks/MultiPages/useAgents";
import {
  DEFAULT_CALENDAR_SETTINGS,
  DEFAULT_CALENDAR_TASK_FILTERS,
  DEFAULT_CALENDAR_VIEWS,
  sanitizeCalendarViewsPreference,
  type CalendarEverythingOverride,
  type CalendarSavedView,
  type CalendarViewCreateInput,
  type CalendarSettings,
  type CalendarSort,
  type CalendarTaskFilters,
  type CalendarViewsOperation,
  type CalendarViewsPreference,
} from "@/models/Calendar/model";
import {
  fetchUserPreference,
  USER_PREFERENCES_QUERY_KEY,
  useGetUserPreferences,
  type IUserPreferences,
} from "@/hooks/General/useGetUserPreferences";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncedCalendarReadModel } from "./useSyncedCalendarReadModel";
import type {
  CalendarLabelSummary,
  CalendarUserSummary,
} from "@/lib/calendarSync/contract";
import type { ViewVisibility } from "@prisma/client";
import { materializeCalendarViewProjectIds } from "@/models/Calendar/visibility";
import {
  clearCalendarSessionDraft,
  readCalendarSessionDraft,
  resolveCalendarSessionDraft,
  writeCalendarSessionDraft,
} from "@/lib/calendarSessionDraft";
import { markTaskDetailNavigationStart } from "@/lib/analytics/taskDetailReadiness";

export const CALENDAR_VIEWS_QUERY_KEY = ["calendar-views"] as const;

const fetchCalendarViews = async (): Promise<CalendarSavedView[]> => {
  const response = await axios.get("/api/calendar/views");
  return response.data.views as CalendarSavedView[];
};

const normalizedTaskFilters = (
  filters: CalendarTaskFilters,
): CalendarTaskFilters => ({
  assignedToMe: filters.assignedToMe,
  updatedBy: [...filters.updatedBy].sort((a, b) => a - b),
  createdBy: [...filters.createdBy].sort((a, b) => a - b),
  priority: [...filters.priority].sort((a, b) => a - b),
  assignees: [...filters.assignees].sort((a, b) => a - b),
  assigneeAgents: [...filters.assigneeAgents].sort(),
  updatedByAgents: [...filters.updatedByAgents].sort(),
  labels: [...filters.labels].sort(),
  size: [...filters.size].sort((a, b) => a - b),
  matchFilters: filters.matchFilters,
});

type CalendarViewState = Pick<
  CalendarSavedView,
  "checkedProjects" | "taskFilters" | "settings" | "sort"
>;

const canonicalCalendarViewState = (
  state: CalendarViewState,
): CalendarViewState => ({
  checkedProjects: [...new Set(state.checkedProjects)].sort((a, b) => a - b),
  taskFilters: normalizedTaskFilters(state.taskFilters),
  settings: {
    weekStartsOn: state.settings.weekStartsOn,
    showWeekends: state.settings.showWeekends,
    view: state.settings.view,
  },
  sort: state.sort
    ? { mode: state.sort.mode, order: state.sort.order }
    : null,
});

const DEFAULT_CALENDAR_VIEW_STATE: CalendarViewState = {
  checkedProjects: [],
  taskFilters: DEFAULT_CALENDAR_TASK_FILTERS,
  settings: { ...DEFAULT_CALENDAR_SETTINGS, view: "week" },
  sort: null,
};

type CalendarTaskFilterSets = {
  priority: ReadonlySet<number>;
  size: ReadonlySet<number>;
  assignees: ReadonlySet<number>;
  assigneeAgents: ReadonlySet<string>;
  updatedBy: ReadonlySet<number>;
  createdBy: ReadonlySet<number>;
  updatedByAgents: ReadonlySet<string>;
  labels: ReadonlySet<string>;
};

const buildCalendarTaskFilterSets = (
  filters: CalendarTaskFilters,
): CalendarTaskFilterSets => ({
  priority: new Set(filters.priority),
  size: new Set(filters.size),
  assignees: new Set(filters.assignees),
  assigneeAgents: new Set(filters.assigneeAgents),
  updatedBy: new Set(filters.updatedBy),
  createdBy: new Set(filters.createdBy),
  updatedByAgents: new Set(filters.updatedByAgents),
  labels: new Set(filters.labels),
});

export function useCalendarView(accountId: number) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentView, setCurrentView] = useRecoilState(currentViewAtom);
  const [calendarSettings, setCalendarSettings] = useRecoilState(calendarSettingsAtom);
  const {
    tasks: allData,
    projects,
    isPending: isCalendarDataPending,
    hasError: calendarDataError,
    retry: retryCalendarData,
    reconcile: reconcileCalendar,
    updateTaskProjection,
  } = useSyncedCalendarReadModel({
    accountId,
    currentDate,
    currentView,
    weekStartsOn: calendarSettings.weekStartsOn,
  });
  const [currentDay, setCurrentDay] = useState<Date>(
    new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate()
    )
  );
  const [currentTask, setCurrentTask] = useState<number>(-1);
  const viewRef = useRef<"month" | "week" | "day" | null>(null);
  const pendingDateSelectRef = useRef<Date | null>(null);
  const hasInitializedTaskRef = useRef<boolean>(false);
  const lastGClickRef = useRef<number | null>(null);
  const currentProjectCycleIndexRef = useRef<number>(-1);
  const urlStateAppliedRef = useRef<boolean>(false);
  // A deep link's view/date must survive hydration, but it must not suppress
  // hydration: the address bar always carries these params once the sync
  // effect has written them, so treating their presence as "the user already
  // interacted" blocked every session-draft restore on a history return
  // (HTPR-5391). Remember them instead, and re-apply them afterwards.
  // Set when the mount effect applies view/date from the address bar. The next
  // baseline comparison re-baselines instead of reading that render as the user
  // touching the calendar.
  const urlBaselineSyncPending = useRef<boolean>(false);
  const urlDeepLinkRef = useRef<{
    view: "month" | "week" | "day" | null;
    date: Date | null;
  }>({ view: null, date: null });

  // Shareable URLs: /calendar?view=day&date=2026-07-31 (HTPR-4759).
  // Read once on mount; a valid query wins over the persisted view atom.
  useEffect(() => {
    if (!window.location.pathname.startsWith("/calendar")) return;
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view");
    const date = params.get("date");
    // changeQueued: a re-render is coming, so the sync effect will get a
    // second run with the applied values. A valid-but-equal param queues
    // nothing, and the mount write (same values) must then go through.
    let validParam = false;
    let changeQueued = false;
    let viewChangeQueued = false;
    if (view === "day" || view === "week" || view === "month") {
      validParam = true;
      urlDeepLinkRef.current.view = view;
      if (view !== currentView) {
        setCurrentView(view);
        changeQueued = true;
        // currentView is the only URL-driven value inside the baseline JSON, so
        // it is the only one that can make the comparison effect fire. Arming
        // the flag for a date-only link would leave it set, and the next real
        // user change would be swallowed as "the URL talking".
        viewChangeQueued = true;
      }
    }
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const [year, month, day] = date.split("-").map(Number);
      const parsed = new Date(year, month - 1, day);
      // Reject impossible dates instead of letting Date roll them over
      // (2026-02-31 would otherwise open March 3).
      if (
        parsed.getFullYear() === year &&
        parsed.getMonth() === month - 1 &&
        parsed.getDate() === day
      ) {
        validParam = true;
        urlDeepLinkRef.current.date = parsed;
        if (
          parsed.getTime() !==
          new Date(
            currentDate.getFullYear(),
            currentDate.getMonth(),
            currentDate.getDate()
          ).getTime()
        ) {
          setCurrentDate(parsed);
          setCurrentDay(parsed);
          changeQueued = true;
        }
      }
    }
    if (changeQueued) {
      // Skip the sync effect's mount run, which still sees pre-URL
      // state and would clobber the very params being shared.
      urlStateAppliedRef.current = true;
    }
    if (viewChangeQueued) {
      urlBaselineSyncPending.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the address bar current so copying it always shares what you see.
  // Serializes currentDate (the anchor that decides what is displayed;
  // currentDay can sit in an adjacent month's filler cells). replaceState
  // only: a Next router navigation here would re-render the app and can
  // cancel in-flight navigation (see openwiki on router.refresh).
  useEffect(() => {
    if (urlStateAppliedRef.current) {
      urlStateAppliedRef.current = false;
      return;
    }
    if (!window.location.pathname.startsWith("/calendar")) return;
    const params = new URLSearchParams(window.location.search);
    params.set("view", currentView);
    const pad = (n: number) => String(n).padStart(2, "0");
    params.set(
      "date",
      `${currentDate.getFullYear()}-${pad(currentDate.getMonth() + 1)}-${pad(currentDate.getDate())}`
    );
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${params.toString()}`
    );
  }, [currentView, currentDate]);
  const { updateTaskInCache } = UpdateKanban();
  const { updateActiveItemAndItemInView, goToProjectShortcut } =
    useProjectQuery();
  const setTaskPlayList = useSetRecoilState(tasksPlayListAtom);
  const { getDefaultOptions } = useGetTimeOptions();
  const [showDueDateModal, setShowDueDateModal] = useState<
    { show: boolean; mode: "Create" | "Update", selectedTask?: ITask } | undefined
  >(undefined);
  const [showManageTasksModal, setShowManageTasksModal] = useState<{ show: boolean, date: Date } | undefined>(undefined);
  const [showFilterModal, setShowFilterModal] = useState<boolean>(false);
  const router = useRouter();
  const isApple = useDeviceContext();
  const createTaskModal = useRecoilValue(
    showCreateTaskModalAtom
  );
  const [checkedProjects, setCheckedProjects] = useRecoilState(
    calendarCheckedProjectsAtom
  );
  const [taskFilters, setTaskFilters] = useRecoilState(
    calendarTaskFiltersAtom
  );
  const [calendarSort, setCalendarSort] = useRecoilState(calendarSortAtom);
  const { allAgents } = useAgents();
  const queryClient = useQueryClient();
  const userPreferencesQuery = useGetUserPreferences();
  const calendarViewsQueryKey = useMemo(
    () => [...CALENDAR_VIEWS_QUERY_KEY, accountId] as const,
    [accountId],
  );
  const calendarViewsQuery = useQuery({
    queryKey: calendarViewsQueryKey,
    queryFn: fetchCalendarViews,
    initialData: [] as CalendarSavedView[],
    initialDataUpdatedAt: 0,
    refetchOnWindowFocus: true,
    staleTime: 60 * 1000,
  });
  const hasHydratedCalendarViews = useRef(false);
  const hasInteractedWithCalendarState = useRef(false);
  const skipNextCalendarSessionDraftWrite = useRef(false);
  const calendarViewsWriteQueue = useRef<Promise<unknown>>(Promise.resolve());
  const calendarViewsWriteVersion = useRef(0);
  const calendarViewsNeedServerState = useRef(false);
  const calendarViewsPreference = useMemo(
    () =>
      sanitizeCalendarViewsPreference(
        userPreferencesQuery.data.calendarViews,
      ) ?? DEFAULT_CALENDAR_VIEWS,
    [userPreferencesQuery.data.calendarViews],
  );
  const everythingTitle =
    calendarViewsPreference.everything?.title ?? "Everything";
  const calendarViews = useMemo(
    () =>
      [...calendarViewsQuery.data].sort((left, right) => {
        if (left.visibility !== right.visibility) {
          return left.visibility === "Private" ? -1 : 1;
        }
        return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      }),
    [calendarViewsQuery.data],
  );
  const appliedCalendarViewId = calendarViews.some(
    (view) => view.id === calendarViewsPreference.appliedViewId,
  )
    ? calendarViewsPreference.appliedViewId
    : null;

  const applyCalendarViewState = useCallback(
    (
      view: CalendarViewState | null,
      // Overwritten state of the Everything split: applied when no saved
      // view is (HTPR-4766).
      everything: CalendarEverythingOverride | null = null,
    ) => {
      const state = view ?? everything;
      if (!state) {
        setCheckedProjects({});
        setTaskFilters(DEFAULT_CALENDAR_TASK_FILTERS);
        setCalendarSettings(DEFAULT_CALENDAR_SETTINGS);
        setCurrentView("week");
        setCalendarSort(null);
        return;
      }

      setCheckedProjects(
        Object.fromEntries(
          state.checkedProjects.map((projectId) => [projectId, true]),
        ),
      );
      setTaskFilters(state.taskFilters);
      setCalendarSettings({
        weekStartsOn: state.settings.weekStartsOn,
        showWeekends: state.settings.showWeekends,
      });
      // Same anchor carry-over as setCurrentViewFromInteraction.
      if (state.settings.view === "day") setCurrentDate(currentDay);
      setCurrentView(state.settings.view);
      setCalendarSort(state.sort);
    },
    [
      setCalendarSettings,
      setCalendarSort,
      setCheckedProjects,
      setCurrentView,
      setTaskFilters,
      currentDay,
    ],
  );
  const applyStoredCalendarViewState = useCallback(
    (value: unknown) => {
      const preference =
        sanitizeCalendarViewsPreference(value) ?? DEFAULT_CALENDAR_VIEWS;
      const appliedView = calendarViews.find(
        (view) => view.id === preference.appliedViewId,
      );
      applyCalendarViewState(appliedView ?? null, preference.everything ?? null);
    },
    [applyCalendarViewState, calendarViews],
  );
  const initialCalendarViewState = useRef(
    JSON.stringify({
      checkedProjects,
      taskFilters,
      calendarSettings,
      currentView,
      calendarSort,
    }),
  );

  useEffect(() => {
    if (hasHydratedCalendarViews.current) return;
    const nextState = JSON.stringify({
      checkedProjects,
      taskFilters,
      calendarSettings,
      currentView,
      calendarSort,
    });
    if (initialCalendarViewState.current === nextState) return;
    if (urlBaselineSyncPending.current) {
      // This render is the address bar being applied, not the user changing
      // anything. Re-baseline so it cannot masquerade as prior interaction and
      // suppress the session-draft restore that has not run yet (HTPR-5391).
      urlBaselineSyncPending.current = false;
      initialCalendarViewState.current = nextState;
      return;
    }
    hasInteractedWithCalendarState.current = true;
  }, [
    calendarSettings,
    calendarSort,
    checkedProjects,
    currentView,
    taskFilters,
  ]);

  // A saved view or session draft carries its own view (and, for "day", its own
  // anchor date). Put the deep link's values back on top so a shared URL still
  // opens what it points at.
  const restoreUrlDeepLink = useCallback(() => {
    const { view, date } = urlDeepLinkRef.current;
    if (view) setCurrentView(view);
    if (date) {
      setCurrentDate(date);
      setCurrentDay(date);
    }
  }, [setCurrentView]);

  useEffect(() => {
    if (
      hasHydratedCalendarViews.current ||
      userPreferencesQuery.dataUpdatedAt === 0 ||
      calendarViewsQuery.dataUpdatedAt === 0
    ) {
      return;
    }
    hasHydratedCalendarViews.current = true;
    if (hasInteractedWithCalendarState.current) return;
    const sessionDraft = resolveCalendarSessionDraft(
      readCalendarSessionDraft(window.sessionStorage, accountId),
      appliedCalendarViewId,
    );
    if (sessionDraft) {
      skipNextCalendarSessionDraftWrite.current = true;
      applyCalendarViewState(sessionDraft);
      restoreUrlDeepLink();
      return;
    }
    const appliedView = calendarViews.find(
      (view) => view.id === calendarViewsPreference.appliedViewId,
    );
    if (appliedView) applyCalendarViewState(appliedView);
    else if (calendarViewsPreference.everything)
      applyCalendarViewState(null, calendarViewsPreference.everything);
    restoreUrlDeepLink();
  }, [
    applyCalendarViewState,
    accountId,
    appliedCalendarViewId,
    calendarViews,
    calendarViewsQuery.dataUpdatedAt,
    calendarViewsPreference,
    restoreUrlDeepLink,
    userPreferencesQuery.dataUpdatedAt,
  ]);

  const persistCalendarViews = useCallback(
    async (
      operation: CalendarViewsOperation,
      calendarViews: CalendarViewsPreference,
    ) => {
      const writeVersion = ++calendarViewsWriteVersion.current;
      queryClient.setQueryData<IUserPreferences>(
        USER_PREFERENCES_QUERY_KEY,
        (current) =>
          current ? { ...current, calendarViews } : current,
      );

      try {
        const request = calendarViewsWriteQueue.current
          .catch(() => {})
          .then(async () => {
            try {
              return await axios.patch("/api/users/preferences", {
                calendarViewsOperation: operation,
              });
            } catch (error) {
              await queryClient.invalidateQueries({
                queryKey: USER_PREFERENCES_QUERY_KEY,
                refetchType: "none",
              });
              const preferences = await queryClient.fetchQuery({
                queryKey: USER_PREFERENCES_QUERY_KEY,
                queryFn: () => fetchUserPreference(false),
                staleTime: 0,
              });
              applyStoredCalendarViewState(preferences.calendarViews);
              if (writeVersion !== calendarViewsWriteVersion.current) {
                calendarViewsNeedServerState.current = true;
              }
              throw error;
            }
          });
        calendarViewsWriteQueue.current = request;
        const response = await request;
        if (writeVersion === calendarViewsWriteVersion.current) {
          queryClient.setQueryData<IUserPreferences>(
            USER_PREFERENCES_QUERY_KEY,
            response.data.settings,
          );
          if (calendarViewsNeedServerState.current) {
            applyStoredCalendarViewState(
              response.data.settings.calendarViews,
            );
            calendarViewsNeedServerState.current = false;
          }
        }
        return true;
      } catch (error) {
        console.error("Could not save calendar view preference:", error);
        toast.error(
          axios.isAxiosError(error) &&
            typeof error.response?.data?.error === "string"
            ? error.response.data.error
            : "Could not save calendar views",
        );
        return false;
      }
    },
    [applyStoredCalendarViewState, queryClient],
  );
  const setCurrentViewFromInteraction: typeof setCurrentView = useCallback(
    (value) => {
      hasInteractedWithCalendarState.current = true;
      // Day view anchors on currentDate; carry the focused day over so
      // switching to Day opens the day the user is on, not the old anchor.
      if (value === "day") setCurrentDate(currentDay);
      setCurrentView(value);
    },
    [setCurrentView, setCurrentDate, currentDay],
  );
  const setCalendarSortFromInteraction: typeof setCalendarSort = useCallback(
    (value) => {
      hasInteractedWithCalendarState.current = true;
      setCalendarSort(value);
    },
    [setCalendarSort],
  );

  const currentCalendarView = useMemo<CalendarViewState>(
    () => ({
      ...canonicalCalendarViewState({
        checkedProjects: Object.entries(checkedProjects)
          .filter(([, checked]) => checked)
          .map(([projectId]) => Number(projectId)),
        taskFilters,
        settings: {
          weekStartsOn: calendarSettings.weekStartsOn,
          showWeekends: calendarSettings.showWeekends,
          view: currentView,
        },
        sort: calendarSort,
      }),
    }),
    [
      calendarSettings,
      calendarSort,
      checkedProjects,
      currentView,
      taskFilters,
    ],
  );

  const applyCalendarView = useCallback(
    async (viewId: string | null) => {
      hasInteractedWithCalendarState.current = true;
      const view =
        calendarViews.find((item) => item.id === viewId) ?? null;
      applyCalendarViewState(view, calendarViewsPreference.everything ?? null);
      await persistCalendarViews(
        { type: "setAppliedViewId", appliedViewId: view?.id ?? null },
        {
          ...calendarViewsPreference,
          appliedViewId: view?.id ?? null,
        },
      );
    },
    [
      applyCalendarViewState,
      calendarViews,
      calendarViewsPreference,
      persistCalendarViews,
    ],
  );

  const saveCalendarView = useCallback(
    async (
      title: string,
      updateApplied: boolean,
      visibility: ViewVisibility,
    ) => {
      const appliedView = calendarViews.find(
        (view) => view.id === appliedCalendarViewId,
      );
      if (updateApplied && !appliedView) {
        const trimmedTitle = title.trim();
        if (trimmedTitle.length > 60) return false;
        const previousTitle =
          calendarViewsPreference.everything?.title?.trim();
        const everything: CalendarEverythingOverride = {
          ...canonicalCalendarViewState(currentCalendarView),
          ...(trimmedTitle
            ? { title: trimmedTitle }
            : previousTitle
              ? { title: previousTitle }
              : {}),
        };
        return persistCalendarViews(
          { type: "setEverything", everything },
          { ...calendarViewsPreference, everything },
        );
      }
      const trimmedTitle = title.trim();
      if (!trimmedTitle || trimmedTitle.length > 60) return false;
      const savedVisibility =
        updateApplied && appliedView ? appliedView.visibility : visibility;
      const input: CalendarViewCreateInput = {
        title: trimmedTitle,
        visibility: savedVisibility,
        projectIds: materializeCalendarViewProjectIds(
          savedVisibility,
          currentCalendarView.checkedProjects,
          projects.map((project) => project.id),
        ),
        taskFilters: currentCalendarView.taskFilters,
        settings: currentCalendarView.settings,
        sort: currentCalendarView.sort,
      };
      try {
        if (updateApplied && appliedView) {
          const response = await axios.patch(
            `/api/calendar/views/${appliedView.id}`,
            { ...input, visibility: appliedView.visibility },
          );
          queryClient.setQueryData<CalendarSavedView[]>(
            calendarViewsQueryKey,
            (current) => current?.map((view) =>
              view.id === appliedView.id ? response.data.view : view,
            ) ?? [response.data.view],
          );
          await queryClient.invalidateQueries({ queryKey: calendarViewsQueryKey });
          return true;
        }

        const response = await axios.post("/api/calendar/views", input);
        const createdView = response.data.view as CalendarSavedView;
        queryClient.setQueryData<CalendarSavedView[]>(
          calendarViewsQueryKey,
          (current) => [...(current ?? []), createdView],
        );
        try {
          await queryClient.invalidateQueries({ queryKey: calendarViewsQueryKey });
        } catch (error) {
          console.error("Could not refresh calendar views after create:", error);
        }
        const applied = await persistCalendarViews(
          { type: "setAppliedViewId", appliedViewId: createdView.id },
          { ...calendarViewsPreference, appliedViewId: createdView.id },
        );
        return applied;
      } catch (error) {
        toast.error(
          axios.isAxiosError(error) &&
            typeof error.response?.data?.error === "string"
            ? error.response.data.error
            : "Could not save calendar view",
        );
        return false;
      }
    },
    [
      appliedCalendarViewId,
      calendarViews,
      calendarViewsQueryKey,
      calendarViewsPreference,
      currentCalendarView,
      persistCalendarViews,
      projects,
      queryClient,
    ],
  );

  const renameCalendarView = useCallback(
    async (viewId: string, title: string) => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle || trimmedTitle.length > 60) return false;
      const renamedView = calendarViews.find(
        (view) => view.id === viewId,
      );
      if (!renamedView) return false;
      try {
        const response = await axios.patch(`/api/calendar/views/${viewId}`, {
          title: trimmedTitle,
        });
        queryClient.setQueryData<CalendarSavedView[]>(
          calendarViewsQueryKey,
          (current) => current?.map((view) =>
            view.id === viewId ? response.data.view : view,
          ) ?? [response.data.view],
        );
        await queryClient.invalidateQueries({ queryKey: calendarViewsQueryKey });
        return true;
      } catch (error) {
        toast.error(
          axios.isAxiosError(error) &&
            typeof error.response?.data?.error === "string"
            ? error.response.data.error
            : "Could not rename calendar view",
        );
        return false;
      }
    },
    [calendarViews, calendarViewsQueryKey, queryClient],
  );

  const renameEverything = useCallback(
    async (title: string) => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle || trimmedTitle.length > 60) return false;
      const everything: CalendarEverythingOverride = {
        ...canonicalCalendarViewState(
          calendarViewsPreference.everything ?? DEFAULT_CALENDAR_VIEW_STATE,
        ),
        title: trimmedTitle,
      };
      return persistCalendarViews(
        { type: "setEverything", everything },
        { ...calendarViewsPreference, everything },
      );
    },
    [calendarViewsPreference, persistCalendarViews],
  );

  const deleteCalendarView = useCallback(
    async (viewId: string) => {
      const deletingApplied = appliedCalendarViewId === viewId;
      try {
        await axios.delete(`/api/calendar/views/${viewId}`);
        queryClient.setQueryData<CalendarSavedView[]>(
          calendarViewsQueryKey,
          (current) => current?.filter((view) => view.id !== viewId) ?? [],
        );
        await queryClient.invalidateQueries({ queryKey: calendarViewsQueryKey });
        if (!deletingApplied) return true;
        applyCalendarViewState(null, calendarViewsPreference.everything ?? null);
        return persistCalendarViews(
          { type: "setAppliedViewId", appliedViewId: null },
          { ...calendarViewsPreference, appliedViewId: null },
        );
      } catch (error) {
        toast.error(
          axios.isAxiosError(error) &&
            typeof error.response?.data?.error === "string"
            ? error.response.data.error
            : "Could not delete calendar view",
        );
        return false;
      }
    },
    [
      applyCalendarViewState,
      appliedCalendarViewId,
      calendarViewsQueryKey,
      calendarViewsPreference,
      persistCalendarViews,
      queryClient,
    ],
  );

  const resetEverything = useCallback(async () => {
    if (calendarViewsPreference.appliedViewId === null) {
      hasInteractedWithCalendarState.current = true;
      applyCalendarViewState(null, null);
    }
    return persistCalendarViews(
      { type: "setEverything", everything: null },
      { ...calendarViewsPreference, everything: null },
    );
  }, [applyCalendarViewState, calendarViewsPreference, persistCalendarViews]);

  const resetCalendarView = useCallback(() => {
    hasInteractedWithCalendarState.current = true;
    const appliedView = calendarViews.find(
      (view) => view.id === appliedCalendarViewId,
    );
    applyCalendarViewState(
      appliedView ?? null,
      calendarViewsPreference.everything ?? null,
    );
  }, [appliedCalendarViewId, applyCalendarViewState, calendarViews, calendarViewsPreference]);

  const isCalendarViewDirty = useMemo(() => {
    const appliedView = calendarViews.find(
      (view) => view.id === appliedCalendarViewId,
    );
    const baseline =
      appliedView ??
      calendarViewsPreference.everything ??
      DEFAULT_CALENDAR_VIEW_STATE;
    return (
      JSON.stringify(canonicalCalendarViewState(currentCalendarView)) !==
      JSON.stringify(canonicalCalendarViewState(baseline))
    );
  }, [appliedCalendarViewId, calendarViews, calendarViewsPreference, currentCalendarView]);

  useEffect(() => {
    if (!hasHydratedCalendarViews.current) return;
    if (skipNextCalendarSessionDraftWrite.current) {
      skipNextCalendarSessionDraftWrite.current = false;
      return;
    }
    if (!isCalendarViewDirty) {
      clearCalendarSessionDraft(window.sessionStorage, accountId);
      return;
    }
    writeCalendarSessionDraft(window.sessionStorage, accountId, {
      appliedViewId: appliedCalendarViewId,
      state: currentCalendarView,
    });
  }, [
    accountId,
    appliedCalendarViewId,
    currentCalendarView,
    isCalendarViewDirty,
  ]);

  // Filter tasks using calendarTaskFiltersAtom (taskFilters). Priority: empty = no filter; non-empty = task must match one of the priority indices.
  const isPriorityFilter = useCallback((task: ITask, priorityIndices: ReadonlySet<number>): boolean => {
    if (priorityIndices.size === 0) return false;
    return priorityIndices.has(task.priority?.priority_index ?? 0);
  }, []);

  const isSizeFilter = useCallback((task: ITask, sizeIndices: ReadonlySet<number>): boolean => {
    if (sizeIndices.size === 0) return false;
    return sizeIndices.has(task.estimate?.estimate_index ?? 0);
  }, []);

  const isAssignedToMeFilter = useCallback((task: ITask, assignedToMe: boolean): boolean => {
    if (!assignedToMe) return false;
    return isTaskAssignedToMe(task, accountId);
  }, [accountId]);

  const isAssigneesFilter = useCallback((task: ITask, assignees: ReadonlySet<number>): boolean => {
    if (assignees.size === 0) return false;
    return task.assignees?.some((assignee) => assignees.has(assignee.userId)) ?? false;
  }, []);

  const isUpdatedByFilter = useCallback((task: ITask, updatedBy: ReadonlySet<number>): boolean => {
    if (updatedBy.size === 0) return false;
    return task.updatedByUserIds?.some((userId) => updatedBy.has(userId)) ?? false;
  }, []);

  const isCreatedByFilter = useCallback((task: ITask, createdBy: ReadonlySet<number>): boolean => {
    if (createdBy.size === 0) return false;
    return createdBy.has(Number(task.userId));
  }, []);

  const isLabelsFilter = useCallback((task: ITask, labels: ReadonlySet<string>): boolean => {
    if (labels.size === 0) return false;
    // Calendar has no per-label value match mode, so labels keep ANY semantics.
    return task.taskLabels?.some((tl) => tl.label?.id != null && labels.has(tl.label.id)) ?? false;
  }, []);

  const isAssigneeAgentsFilter = useCallback((task: ITask, assigneeAgents: ReadonlySet<string>): boolean => {
    if (assigneeAgents.size === 0) return false;
    return task.assignees?.some((assignee) =>
      assignee.agentId != null && assigneeAgents.has(assignee.agentId)
    ) ?? false;
  }, []);

  const isUpdatedByAgentsFilter = useCallback((task: ITask, updatedByAgents: ReadonlySet<string>): boolean => {
    if (updatedByAgents.size === 0) return false;
    return task.agentId != null && updatedByAgents.has(task.agentId);
  }, []);

  const taskMatchesFilters = useCallback((task: ITask, filters: CalendarTaskFilters, filterSets: CalendarTaskFilterSets): boolean => {
    const activeChecks: boolean[] = [];
    if (filters.priority.length > 0) {
      activeChecks.push(isPriorityFilter(task, filterSets.priority));
    }
    if (filters.size.length > 0) {
      activeChecks.push(isSizeFilter(task, filterSets.size));
    }
    if (filters.assignedToMe) {
      activeChecks.push(isAssignedToMeFilter(task, filters.assignedToMe));
    }
    if (filters.assignees.length > 0) {
      activeChecks.push(isAssigneesFilter(task, filterSets.assignees));
    }
    if (filters.assigneeAgents.length > 0) {
      activeChecks.push(isAssigneeAgentsFilter(task, filterSets.assigneeAgents));
    }
    if (filters.updatedBy.length > 0) {
      activeChecks.push(isUpdatedByFilter(task, filterSets.updatedBy));
    }
    if (filters.createdBy.length > 0) {
      activeChecks.push(isCreatedByFilter(task, filterSets.createdBy));
    }
    if (filters.updatedByAgents.length > 0) {
      activeChecks.push(isUpdatedByAgentsFilter(task, filterSets.updatedByAgents));
    }
    if (filters.labels.length > 0) {
      activeChecks.push(isLabelsFilter(task, filterSets.labels));
    }

    if (activeChecks.length === 0) return true;
    if (filters.matchFilters === "ALL") return activeChecks.every(Boolean);
    return activeChecks.some(Boolean);
  }, [isPriorityFilter, isSizeFilter, isAssignedToMeFilter, isAssigneesFilter, isAssigneeAgentsFilter, isUpdatedByFilter, isCreatedByFilter, isUpdatedByAgentsFilter, isLabelsFilter]);
  const taskFilterSets = useMemo(
    () => buildCalendarTaskFilterSets(taskFilters),
    [taskFilters],
  );

  const filteredMembers: CalendarUserSummary[] = useMemo(() => {
    const hasSelectedProjects = Object.values(checkedProjects).some(Boolean);
    const projectsToUse = hasSelectedProjects
      ? projects.filter((p) => checkedProjects[p.id] === true)
      : projects;
    const byId = new Map<number, CalendarUserSummary>();
    for (const project of projectsToUse) {
      for (const member of project.members ?? []) {
        const user = member?.user;
        if (user?.id != null && !byId.has(user.id)) {
          byId.set(user.id, user);
        }
      }
    }
    return Array.from(byId.values());
  }, [checkedProjects, projects]);

  const allTags: CalendarLabelSummary[] = useMemo(() => {
    const hasSelectedProjects = Object.values(checkedProjects).some(Boolean);
    const projectsToUse = hasSelectedProjects
      ? projects.filter((p) => checkedProjects[p.id] === true)
      : projects;
    return projectsToUse.flatMap((project) => project.labels);
  }, [checkedProjects, projects]);

  const tasks = useMemo(() => {
    const hasSelectedProjects = Object.values(checkedProjects).some(Boolean);

    const projectFilteredTasks: ITask[] = hasSelectedProjects
      ? allData.filter(
        (task) =>
          task.projectId != null && checkedProjects[task.projectId] === true
      )
      : [...allData];

    const hasActiveTaskFilters = Object.values(taskFilters).some(Boolean);
    if (hasActiveTaskFilters) {
      return projectFilteredTasks.filter((task) =>
        taskMatchesFilters(task, taskFilters, taskFilterSets)
      );
    }

    return projectFilteredTasks;
  }, [allData, checkedProjects, taskFilters, taskFilterSets, taskMatchesFilters]);

  const calendarSortComparator = useMemo(
    () =>
      calendarSort
        ? buildSortComparator([calendarSort])
        : null,
    [calendarSort],
  );

  const tasksByDate = useMemo(() => {
    const map = new Map<string, ITask[]>();
    const hasSelectedProjects = Object.values(checkedProjects).some(Boolean);
    const hasActiveTaskFilters = Object.values(taskFilters).some(Boolean);

    const addTaskToMap = (task: ITask) => {
      if (!task.dueDate) return;

      if (hasActiveTaskFilters) {
        if (!taskMatchesFilters(task, taskFilters, taskFilterSets)) {
          return;
        }
      }

      const taskDate = new Date(task.dueDate);
      const dateKey = `${taskDate.getFullYear()}-${taskDate.getMonth()}-${taskDate.getDate()}`;
      if (!map.has(dateKey)) {
        map.set(dateKey, []);
      }
      map.get(dateKey)!.push(task);
    };

    const tasksToProcess = hasSelectedProjects
      ? allData.filter(
        (task) =>
          task.projectId != null && checkedProjects[task.projectId] === true
      )
      : allData;

    tasksToProcess.forEach(addTaskToMap);
    if (calendarSortComparator) {
      map.forEach((dayTasks) => dayTasks.sort(calendarSortComparator));
    }
    return map;
  }, [allData, calendarSortComparator, checkedProjects, taskFilters, taskFilterSets, taskMatchesFilters]);

  const { weeks } = useMemo(() => {
    const monthStart = getFirstDayOfMonth(currentDate);
    const monthEnd = getLastDayOfMonth(currentDate);
    const startDay = getWeekStartIndex(
      monthStart,
      calendarSettings.weekStartsOn
    );
    const endDay = getWeekStartIndex(monthEnd, calendarSettings.weekStartsOn);

    const daysArray: Date[] = [];
    const weeksArray = [];

    if (currentView === "month") {
      // Add days from previous month
      for (let i = startDay - 1; i >= 0; i--) {
        const date = new Date(monthStart);
        date.setDate(date.getDate() - (i + 1));
        daysArray.push(date);
      }
      // Add days of current month
      for (let i = 1; i <= monthEnd.getDate(); i++) {
        daysArray.push(
          new Date(currentDate.getFullYear(), currentDate.getMonth(), i)
        );
      }
      // Add days from next month
      for (let i = 1; i < 7 - endDay; i++) {
        daysArray.push(
          new Date(monthEnd.getFullYear(), monthEnd.getMonth() + 1, i)
        );
      }

      // Group days into weeks

      for (let i = 0; i < daysArray.length; i += 7) {
        weeksArray.push(daysArray.slice(i, i + 7));
      }
    } else if (currentView === "day") {
      weeksArray.push([
        new Date(
          currentDate.getFullYear(),
          currentDate.getMonth(),
          currentDate.getDate()
        ),
      ]);
    } else {
      const weekStart = startOfWeek(
        currentDate,
        calendarSettings.weekStartsOn
      );
      for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + i);
        if (
          currentView !== "week" ||
          calendarSettings.showWeekends ||
          (date.getDay() !== 0 && date.getDay() !== 6)
        ) {
          daysArray.push(date);
        }
      }
      weeksArray.push(daysArray);
    }

    return { weeks: weeksArray };
  }, [currentDate, currentView, calendarSettings]);

  const { calendarViewCounts, visibleTaskCount } = useMemo(() => {
    const visibleDateKeys = new Set(
      weeks.flat().map(
        (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      ),
    );
    const visibleTasks = allData.filter((task) => {
      if (!task.dueDate) return false;
      const date = new Date(task.dueDate);
      return visibleDateKeys.has(
        `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      );
    });
    const counts = new Map<string, number>();

    for (const view of calendarViews) {
      const selectedProjects = new Set(view.checkedProjects);
      const filterSets = buildCalendarTaskFilterSets(view.taskFilters);
      const hasSelectedProjects = selectedProjects.size > 0;
      counts.set(
        view.id,
        visibleTasks.filter(
          (task) =>
            (!hasSelectedProjects ||
              (task.projectId != null &&
                selectedProjects.has(task.projectId))) &&
            taskMatchesFilters(task, view.taskFilters, filterSets),
        ).length,
      );
    }

    return {
      calendarViewCounts: counts,
      visibleTaskCount: visibleTasks.length,
    };
  }, [
    allData,
    calendarViews,
    taskMatchesFilters,
    weeks,
  ]);

  const getTasksForDate = useCallback((date: Date) => {
    const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    return tasksByDate.get(dateKey) || [];
  }, [tasksByDate]);

  const FOCUS_MORE_INDICATOR = calendarConfig.constants.focus_more_indicator;

  // Helper function to set currentTask, focus on it, and update active item
  const setCurrentTaskWithFocus = useCallback((taskId: number, day?: Date) => {
    setCurrentTask(taskId);

    if (taskId === FOCUS_MORE_INDICATOR && day) {
      const moreElement = document.getElementById(
        calendarConfig.element_ids.more_tasks_indicator(day)
      );
      if (moreElement) {
        moreElement.focus();
        moreElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
      return;
    }

    if (taskId !== -1) {
      // Find the task object
      const task = tasks.find((t) => t.id === taskId);

      if (task) {
        // Focus on the task element
        const taskElement = document.getElementById(`task-${taskId}`);
        if (taskElement) {
          taskElement.focus();
          taskElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }

        // Update active item and item in view
        updateActiveItemAndItemInView(task);
      }
    } else {
      // When there are no tasks, scroll to the day section
      const dayToScroll = day || currentDay;
      const dayElement = document.getElementById(
        `day-${dayToScroll.toISOString()}`
      );
      if (dayElement) {
        // Use setTimeout to ensure the element is fully rendered
        setTimeout(() => {
          dayElement.focus();
          dayElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }, 0);
      }
    }
  }, [tasks, currentDay, updateActiveItemAndItemInView]);

  // Helper function to update focus after date range navigation
  const updateFocusAfterNavigation = (newDate: Date) => {
    // Calculate what days will be in the new range
    const daysInNewRange: Date[] = [];

    if (currentView === "month") {
      const monthStart = getFirstDayOfMonth(newDate);
      const monthEnd = getLastDayOfMonth(newDate);
      const startDay = getWeekStartIndex(
        monthStart,
        calendarSettings.weekStartsOn
      );
      const endDay = getWeekStartIndex(
        monthEnd,
        calendarSettings.weekStartsOn
      );

      // Add days from previous month
      for (let i = startDay - 1; i >= 0; i--) {
        const date = new Date(monthStart);
        date.setDate(date.getDate() - (i + 1));
        daysInNewRange.push(date);
      }
      // Add days of current month
      for (let i = 1; i <= monthEnd.getDate(); i++) {
        daysInNewRange.push(
          new Date(newDate.getFullYear(), newDate.getMonth(), i)
        );
      }
      // Add days from next month
      for (let i = 1; i < 7 - endDay; i++) {
        daysInNewRange.push(
          new Date(monthEnd.getFullYear(), monthEnd.getMonth() + 1, i)
        );
      }
    } else if (currentView === "week") {
      const weekStart = startOfWeek(newDate, calendarSettings.weekStartsOn);
      for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + i);
        if (
          calendarSettings.showWeekends ||
          (date.getDay() !== 0 && date.getDay() !== 6)
        ) {
          daysInNewRange.push(date);
        }
      }
    } else {
      // Day view - just the single day
      daysInNewRange.push(newDate);
    }

    // Find the first day with tasks, or use the first day if no tasks
    let dayToFocus: Date | null = null;
    let taskToFocus: number = -1;

    for (const day of daysInNewRange) {
      const tasksForDay = getTasksForDate(day);
      if (tasksForDay.length > 0) {
        dayToFocus = day;
        taskToFocus = tasksForDay[0].id;
        break;
      }
    }

    // If no tasks found, use the first day
    if (!dayToFocus && daysInNewRange.length > 0) {
      dayToFocus = daysInNewRange[0];
    }

    // Update currentDay and currentTask
    if (dayToFocus) {
      setCurrentDay(dayToFocus);

      // Focus on the day element
      const dayElement = document.getElementById(
        `day-${dayToFocus!.toISOString()}`
      );
      if (dayElement) {
        dayElement.focus();
        dayElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }

      // Set current task
      setCurrentTaskWithFocus(taskToFocus, dayToFocus);
    }
  };

  const updateDueDateHandler = useCallback(async (task: ITask, dueDate: Date | undefined) => {
    try {
      // If dueDate is undefined, we're removing the due date
      const isRemovingDueDate = dueDate === undefined;

      let finalDueDate: Date | undefined = dueDate;

      if (!isRemovingDueDate && dueDate) {
        if (isToday(dueDate)) {
          const nextBestOption = getDefaultOptions()[0];
          finalDueDate = new Date(nextBestOption.date);
        } else {
          finalDueDate = new Date(dueDate);
          finalDueDate.setHours(21, 0, 0, 0);
        }
      }

      // Helper function to normalize dates for comparison (date only, no time)
      const normalizeDateForComparison = (date: Date | string | null | undefined): Date | null => {
        if (!date) return null;
        const d = new Date(date);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
      };

      // Check if the due date is the same as the current task's due date
      const currentTaskDueDate = normalizeDateForComparison(task.dueDate);
      const newDueDateNormalized = normalizeDateForComparison(finalDueDate);

      // Compare dates (handling both null/undefined cases)
      const isSameDueDate =
        (currentTaskDueDate === null && newDueDateNormalized === null) ||
        (currentTaskDueDate !== null &&
          newDueDateNormalized !== null &&
          currentTaskDueDate.getTime() === newDueDateNormalized.getTime());

      //Added this here so it wouldnt call the API and give a 500 error every time.
      if (isSameDueDate) {
        // Due date hasn't changed, no need to send API request
        return;
      }

      // Check if the new due date is in the past (only for non-null dates)
      // Compare normalized dates (date only, no time) to check if it's before today
      if (newDueDateNormalized) {
        const todayNormalized = startOfDay(new Date());
        if (newDueDateNormalized.getTime() < todayNormalized.getTime()) {
          // Date is in the past, show user-friendly message and return
          toast.error("Cannot set due date in the past");
          return;
        }
      }

      const response = await axios.post(calendarConfig.api_endpoints.addTaskToDueDate, {
        taskId: task.id,
        dueDate: finalDueDate || null, // Send null to API when removing due date
      });

      if (response.status === 200) {
        onTaskUpdate(task, { dueDate: finalDueDate });

        if (isRemovingDueDate) {
          // Task will be removed from calendar view, reset current task if it was the removed task
          if (currentTask === task.id) {
            const tasksForCurrentDay = getTasksForDate(currentDay);
            const remainingTasks = tasksForCurrentDay.filter(
              (t) => t.id !== task.id
            );
            setCurrentTaskWithFocus(
              remainingTasks.length > 0 ? remainingTasks[0].id : -1,
              currentDay
            );
          }
        } else if (finalDueDate) {
          // Update current day to the new due date
          // Normalize the date to remove time component to match dates in weeks array
          const normalizedDate = new Date(
            finalDueDate.getFullYear(),
            finalDueDate.getMonth(),
            finalDueDate.getDate()
          );
          setCurrentDay(normalizedDate);
          setCurrentTaskWithFocus(task.id);
          document
            .getElementById(`day-${normalizedDate.toISOString()}`)
            ?.focus();
        }
      }
    } catch (error) {
      console.error("updateDueDateHandler error:", error);
      toast.error(calendarConfig.toast_messages.error.update);
    }
  }, [getDefaultOptions, currentTask, currentDay, getTasksForDate, setCurrentTaskWithFocus, onTaskUpdate]);


  const addTaskToState = useCallback(async (task: ITask, date: Date) => {
    try {
      // Persist the due date to the backend
      const response = await axios.post(calendarConfig.api_endpoints.addTaskToDueDate, {
        taskId: task.id,
        dueDate: date,
      });

      if (response.status === 200) {
        // Create a new task object with the updated dueDate
        const updatedTask: ITask = {
          ...task,
          dueDate: date,
        };

        updateTaskProjection(updatedTask);

        updateTaskInCache(
          updatedTask,
          updatedTask.id,
          updatedTask.projectId,
          updatedTask.sectionId
        );
        reconcileCalendar("manual");
        toast.success(calendarConfig.toast_messages.success.add);
      } else {
        throw new Error("Failed to update due date");
      }
    } catch (error) {
      console.log("🚀 ~ addTaskToState ~ error:", error);
      toast.error(calendarConfig.toast_messages.error.add);
    }
  }, [reconcileCalendar, updateTaskInCache, updateTaskProjection]);

  const dueDateModalCallback = useCallback((date: Date | undefined, taskSelected?: ITask) => {
    try {
      if (currentTask < 0 && !taskSelected) return;
      let taskToUpdate = taskSelected ?? currentTask;
      const task = tasks.find((t) => t.id === taskToUpdate);
      if (!task) return;
      updateDueDateHandler(task, date);
    } catch (error) {
      console.log("🚀 ~ dueDateModalCallback ~ error:", error);
    }
  }, [currentTask, tasks, updateDueDateHandler]);

  const toggleFilterModal = () => setShowFilterModal((prev) => !prev);

  const toggleDueDateModal = useCallback((
    mode?: "Create" | "Update",
    payload?: {
      task?: ITask;
      date: Date | undefined;
    }
  ) => {
    if (!mode) {
      setShowDueDateModal(undefined);
      if (!payload) return;
      const { task, date } = payload;
      const currentMode = showDueDateModal?.mode;

      if (currentMode === "Update") dueDateModalCallback(date || undefined, task);
      else if (currentMode === "Create" && task && date)
        addTaskToState(task, date || undefined);
    } else setShowDueDateModal({ show: true, mode });
  }, [showDueDateModal, dueDateModalCallback, addTaskToState]);

  const handleTaskClick = useCallback((taskDay: Date, task: ITask) => {
    const tasks = getTasksForDate(taskDay);
    setTaskPlayList(
      tasks.map((task) => ({
        projectId: task.projectId,
        uniqueIndex: task.uniqueIndex,
      }))
    );
    const targetUrl = `/detail/project-${task.projectId}/${task.uniqueIndex}`;
    markTaskDetailNavigationStart("calendar", targetUrl);
    router.push(targetUrl);
  }, [getTasksForDate, setTaskPlayList, router]);

  const toggleManageTasksModal = useCallback((
    date: Date,
    close?: boolean,
    mode?: "Add" | "Update" | "Visit",
    task?: ITask
  ) => {
    // Close modal if explicitly requested
    if (close === true) {
      setShowManageTasksModal(undefined);
      return;
    }

    // Handle Add mode - open due date modal in Create mode
    if (mode === "Add") {
      setShowManageTasksModal(undefined);
      setShowDueDateModal({ show: true, mode: "Create" });
      return;
    }

    // Handle Update mode - open due date modal in Update mode with task
    if (mode === "Update" && task) {
      setShowManageTasksModal(undefined);
      updateActiveItemAndItemInView(task);
      setShowDueDateModal({ show: true, mode: "Update", selectedTask: task });
      return;
    }

    // Handle Visit mode - navigate to the task's detail page
    if (mode === "Visit" && task) {
      setShowManageTasksModal(undefined);
      handleTaskClick(date, task);
      return;
    }

    // Default: open manage tasks modal with the provided date
    setShowManageTasksModal({ show: true, date });
  }, [updateActiveItemAndItemInView]);

  function onTaskUpdate(task: ITask, updates: Partial<ITask>) {
    try {
      updateTaskProjection({ ...task, ...updates });
      updateTaskInCache(updates, task.id, task.projectId, task.sectionId);
      reconcileCalendar("manual");
      toast.success(calendarConfig.toast_messages.success.update);
    } catch (error) {
      console.log("🚀 ~ onTaskUpdate ~ error:", error);
    }
  }

  function handleDateSelect(date: Date | undefined) {
    try {
      if (!date) return;

      // Normalize the date to remove time component (set to midnight)
      let normalizedDate = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
      );
      if (
        currentView === "week" &&
        !calendarSettings.showWeekends &&
        (normalizedDate.getDay() === 0 || normalizedDate.getDay() === 6)
      ) {
        normalizedDate = startOfWeek(
          normalizedDate,
          calendarSettings.weekStartsOn
        );
        while (normalizedDate.getDay() === 0 || normalizedDate.getDay() === 6) {
          normalizedDate.setDate(normalizedDate.getDate() + 1);
        }
      }

      // Flatten all days from weeks array to check if date exists in current view
      const allDaysInView = weeks.flat();
      const dateExistsInView = allDaysInView.some((day) =>
        isSameDate(day, normalizedDate)
      );

      if (dateExistsInView) {
        // Date is in current view, focus on it immediately
        setCurrentDay(normalizedDate);

        // Focus on the day element
        const dayElement = document.getElementById(
          `day-${normalizedDate.toISOString()}`
        );
        if (dayElement) {
          dayElement.focus();
          dayElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }

        // Set current task to first task if any, or -1 if no tasks
        const tasksForDate = getTasksForDate(normalizedDate);
        setCurrentTaskWithFocus(
          tasksForDate.length > 0 ? tasksForDate[0].id : -1,
          normalizedDate
        );
      } else {
        // Date is not in current view, navigate to the correct date range
        // Store the target date in ref to handle after weeks recalculate
        pendingDateSelectRef.current = normalizedDate;

        if (currentView === "month") {
          // For month view, set currentDate to the selected date's month
          setCurrentDate(new Date(normalizedDate.getFullYear(), normalizedDate.getMonth(), 1));
        } else if (currentView === "week") {
          // For week view, set currentDate to the selected date (it will calculate the week)
          setCurrentDate(new Date(normalizedDate));
        } else {
          // For day view, set currentDate to the selected date
          setCurrentDate(new Date(normalizedDate));
        }
      }
    } catch (error) {
      console.log("🚀 ~ handleDateSelect ~ error:", error);
    }
  }

  const handleProjectToggle = (projectId: number, checked: boolean) => {
    hasInteractedWithCalendarState.current = true;
    setCheckedProjects((prev) => ({
      ...prev,
      [projectId]: checked,
    }));
  };

  const handleTaskFilterToggle = (filterName: keyof typeof taskFilters, checked: boolean) => {
    hasInteractedWithCalendarState.current = true;
    setTaskFilters((prev) => ({ ...prev, [filterName]: checked }));
  };

  const handleClearFilters = () => {
    hasInteractedWithCalendarState.current = true;
    setCheckedProjects({});
    setTaskFilters((prev) => ({
      ...prev,
      updatedBy: [],
      createdBy: [],
      priority: [],
      assignees: [],
      assigneeAgents: [],
      updatedByAgents: [],
      labels: [],
      size: [],
      assignedToMe: false,
    }));
  };

  const handlePrevious = () => {
    let newDate: Date;
    if (currentView === "month") {
      newDate = subtractMonths(currentDate, 1);
    } else if (currentView === "week") {
      newDate = subtractDays(currentDate, 7);
    } else {
      newDate = subtractDays(currentDate, 1);
    }
    setCurrentDate(newDate);
    // Update focus after navigation
    updateFocusAfterNavigation(newDate);
  };

  const handleNext = () => {
    let newDate: Date;
    if (currentView === "month") {
      newDate = addMonths(currentDate, 1);
    } else if (currentView === "week") {
      newDate = addDays(currentDate, 7);
    } else {
      newDate = addDays(currentDate, 1);
    }
    setCurrentDate(newDate);
    // Update focus after navigation
    updateFocusAfterNavigation(newDate);
  };

  const shiftFocusHorizontally = useCallback((direction: "left" | "right") => {
    try {
      // Day view holds a single day: moving sideways means navigating days.
      if (currentView === "day") {
        if (direction === "left") handlePrevious();
        else handleNext();
        return;
      }
      const daysInView = weeks.flat();
      const currentDayIndex = daysInView.findIndex(
        (day) => isSameDate(day, currentDay)
      );
      if (currentDayIndex === -1) return;
      const nextDayIndex = currentDayIndex + (direction === "left" ? -1 : 1);
      const newDate = daysInView[nextDayIndex];
      if (!newDate) return;

      document.getElementById(`day-${newDate.toISOString()}`)?.focus();
      setCurrentDay(newDate);

      // Update current task based on tasks for the new date
      const tasks = getTasksForDate(newDate);
      setCurrentTaskWithFocus(tasks.length > 0 ? tasks[0].id : -1, newDate);
    } catch (error) {
      console.log("🚀 ~ shiftFocusHorizontally ~ error:", error);
    }
  }, [currentDay, weeks, getTasksForDate, setCurrentTaskWithFocus, currentView, handlePrevious, handleNext]);

  const shiftFocusVertically = useCallback((direction: "up" | "down") => {
    try {
      const currentDayElement = document.getElementById(
        `day-${currentDay.toISOString()}`
      );
      const currentWeekElement = currentDayElement?.parentElement;
      const currentWeekIndex = Number(currentWeekElement?.id?.split("-")[1]);

      const currentTasks = getTasksForDate(currentDay);
      const currentTaskIndex = currentTasks.findIndex(
        (task) => task.id === currentTask
      );

      const hasMoreIndicator =
        currentView === "month" && currentTasks.length > 2;
      const visibleTasksCount =
        currentView === "month"
          ? hasMoreIndicator
            ? 3
            : Math.min(2, currentTasks.length)
          : currentTasks.length;

      const moveToWeek = (weekOffset: number) => {
        const newDate = new Date(
          currentDay.getFullYear(),
          currentDay.getMonth(),
          currentDay.getDate() + weekOffset
        );
        document.getElementById(`day-${newDate.toISOString()}`)?.focus();
        setCurrentDay(newDate);

        const tasks = getTasksForDate(newDate);

        if (direction === "up" && currentView === "month" && tasks.length > 2) {
          setCurrentTaskWithFocus(FOCUS_MORE_INDICATOR, newDate);
          return;
        }

        let taskToSelect;
        if (direction === "up") {
          taskToSelect = tasks[tasks.length - 1];
        } else {
          taskToSelect = tasks[0];
        }

        setCurrentTaskWithFocus(taskToSelect?.id ?? -1, newDate);
      };

      const isFirstWeek =
        direction === "up" && currentWeekIndex === 0 && currentView === "month";
      const isLastWeek =
        direction === "down" &&
        currentWeekIndex === weeks.length - 1 &&
        currentView === "month";

      // Focus is on the "more" indicator (month view, day has >2 tasks)
      if (currentTask === FOCUS_MORE_INDICATOR && currentView === "month") {
        if (direction === "up") {
          setCurrentTaskWithFocus(currentTasks[1].id);
        } else {
          if (isLastWeek) return;
          moveToWeek(7);
        }
        return;
      }

      // If no current task, move to adjacent week
      if (currentTaskIndex === -1 && currentView === "month") {
        if (isFirstWeek || isLastWeek) return;
        moveToWeek(direction === "up" ? -7 : 7);
        return;
      }

      const isAtFirstTask = currentTaskIndex === 0;
      const isAtLastVisibleTask = hasMoreIndicator
        ? currentTaskIndex === 1 // down from task 1 goes to more indicator
        : currentView === "month"
          ? currentTaskIndex === visibleTasksCount - 1
          : currentTaskIndex === currentTasks.length - 1;

      if (direction === "up") {
        if (isAtFirstTask) {
          if (isFirstWeek) return;
          currentView === "month" && moveToWeek(-7);
        } else {
          setCurrentTaskWithFocus(currentTasks[currentTaskIndex - 1].id);
        }
      } else {
        if (isAtLastVisibleTask) {
          if (hasMoreIndicator) {
            setCurrentTaskWithFocus(FOCUS_MORE_INDICATOR, currentDay);
          } else {
            if (isLastWeek) return;
            currentView === "month" && moveToWeek(7);
          }
        } else {
          setCurrentTaskWithFocus(currentTasks[currentTaskIndex + 1].id);
        }
      }
    } catch (error) {
      console.log("🚀 ~ shiftFocusVertically ~ error:", error);
    }
  }, [currentDay, currentTask, currentView, weeks, getTasksForDate, setCurrentTaskWithFocus]);

  const moveTaskHorizontally = useCallback(async (direction: "left" | "right") => {
    try {
      // Check if there's a current task selected (excludes more-indicator focus)
      if (currentTask < 0) return;

      let newDueDate: Date | undefined;
      if (currentView === "day") {
        // Day view shows one day: reschedule relative to it.
        newDueDate =
          direction === "left"
            ? subtractDays(currentDay, 1)
            : addDays(currentDay, 1);
      } else {
        const daysInView = weeks.flat();
        const currentDayIndex = daysInView.findIndex(
          (day) => isSameDate(day, currentDay)
        );
        if (currentDayIndex === -1) return;
        const nextDayIndex = currentDayIndex + (direction === "left" ? -1 : 1);
        newDueDate = daysInView[nextDayIndex];
      }
      if (!newDueDate) return;

      // Get the current task
      const currentTasks = getTasksForDate(currentDay);
      const task = currentTasks.find((t) => t.id === currentTask);
      if (!task) return;

      await updateDueDateHandler(task, newDueDate);
      // Follow the task, as week view's focus does after a move.
      if (currentView === "day") setCurrentDate(newDueDate);
    } catch (error) {
      console.log("🚀 ~ moveTaskHorizontally ~ error:", error);
    }
  }, [currentTask, currentDay, currentView, weeks, getTasksForDate, updateDueDateHandler]);

  const moveTaskVertically = useCallback(async (direction: "up" | "down") => {
    try {
      // Check if there's a current task selected (excludes more-indicator focus)
      if (currentTask < 0) return;
      if (currentView === "week") return;

      const currentDayElement = document.getElementById(
        `day-${currentDay.toISOString()}`
      );
      const currentWeekElement = currentDayElement?.parentElement;
      const currentWeekIndex = Number(currentWeekElement?.id?.split("-")[1]);

      // Check boundary conditions
      if (direction === "up" && currentWeekIndex === 0) return;
      if (direction === "down" && currentWeekIndex === weeks.length - 1) return;

      // Get the current task
      const currentTasks = getTasksForDate(currentDay);
      const task = currentTasks.find((t) => t.id === currentTask);
      if (!task) return;

      // Calculate new date (move by 7 days for one week)
      const weekOffset = direction === "up" ? -7 : 7;
      const newDueDate = new Date(
        currentDay.getFullYear(),
        currentDay.getMonth(),
        currentDay.getDate() + weekOffset
      );

      await updateDueDateHandler(task, newDueDate);
    } catch (error) {
      console.log("🚀 ~ moveTaskVertically ~ error:", error);
    }
  }, [currentTask, currentView, currentDay, weeks, getTasksForDate, updateDueDateHandler]);

  async function onDragEnd(result: DropResult) {
    try {
      if (
        !result ||
        !result.destination ||
        !result.source ||
        !result.draggableId
      )
        return;

      const sourceElement = document.getElementById(result.source.droppableId);
      const destinationElement = document.getElementById(
        result.destination.droppableId
      );
      const taskId = parseInt(result.draggableId.split("-")[1]);
      if (!sourceElement || !destinationElement) return;

      const task = tasks.find((task) => task.id === taskId);
      if (!task) return;
      const newDueDate = new Date(destinationElement.id.replace("day-", ""));
      if (!newDueDate) return;
      await updateDueDateHandler(task, newDueDate);
    } catch (error) {
      console.log("🚀 ~ onDragEnd ~ error:", error);
      toast.error(calendarConfig.toast_messages.error.update);
    }
  }

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (showDueDateModal?.show || createTaskModal.show || showFilterModal) return;
    if (returnIfModalOrInputActive()) return;
    let cmdControl = (isApple && event.metaKey) || (!isApple && event.ctrlKey);

    // Handle Tab key navigation and prevent default focus behavior
    if (matchesShortcut(event, ks.calendar.focus_previous_day)) {
      event.preventDefault();
      shiftFocusHorizontally("left");
    } else if (matchesShortcut(event, ks.calendar.focus_next_day)) {
      event.preventDefault();
      shiftFocusHorizontally("right");
    }

    //I do feel like calling a function to check if it matches the shortcut is a little weird/overkill here. 
    if (matchesShortcut(event, ks.universal_movement.left))
      shiftFocusHorizontally("left");
    else if (matchesShortcut(event, ks.universal_movement.right))
      shiftFocusHorizontally("right");
    else if (matchesShortcut(event, ks.universal_movement.up))
      shiftFocusVertically("up");
    else if (matchesShortcut(event, ks.universal_movement.down))
      shiftFocusVertically("down");
    else if (
      matchesShortcut(event, ks.universal_shift.left)
    ) moveTaskHorizontally("left");
    else if (matchesShortcut(event, ks.universal_shift.right))
      moveTaskHorizontally("right");
    else if (matchesShortcut(event, ks.universal_shift.up))
      moveTaskVertically("up");
    else if (matchesShortcut(event, ks.universal_shift.down))
      moveTaskVertically("down");
    //wdsf

    if (matchesShortcut(event, ks.dueDateModal.default) && currentTask >= 0)
      toggleDueDateModal("Update");

    if (event.keyCode === KeyCodes.ENTER) {
      event.preventDefault();
      if (currentTask === FOCUS_MORE_INDICATOR) {
        setTimeout(() => toggleManageTasksModal(currentDay), 200);
        return;
      }
      if (currentTask >= 0)
        return handleTaskClick(
          currentDay,
          tasks.find((task) => task.id === currentTask)!
        );
      return toggleDueDateModal("Create");
    }

    // [g] press - track for G then T shortcut
    if (event.keyCode === KeyCodes.G) {
      const now = new Date().getTime();
      lastGClickRef.current = now;
      setTimeout(() => {
        lastGClickRef.current = null;
      }, globalConstants.gThenKeyDelay);
    }

    // [g] then [t] for go to project shortcut
    if (event.keyCode === KeyCodes.T) {
      const now = new Date().getTime();
      if (
        lastGClickRef.current &&
        now - lastGClickRef.current < globalConstants.gThenKeyDelay
      ) {
        event.preventDefault();
        lastGClickRef.current = null;

        // Get projectId from current task if available
        if (currentTask >= 0) {
          const task = tasks.find((t) => t.id === currentTask);
          if (task?.projectId) {
            goToProjectShortcut(task.projectId, true);
          }
        }
        return;
      }
    }

    if (
      event.keyCode === KeyCodes.D &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const now = new Date().getTime();
      if (
        lastGClickRef.current &&
        now - lastGClickRef.current < globalConstants.gThenKeyDelay
      ) {
        event.preventDefault();
        lastGClickRef.current = null;
        router.push(globalConstants.draftsRoute);
        return;
      }
    }

    if (event.keyCode === KeyCodes.U) {
      const now = new Date().getTime();
      if (
        lastGClickRef.current &&
        now - lastGClickRef.current < globalConstants.gThenKeyDelay
      ) {
        event.preventDefault();
        lastGClickRef.current = null;
        router.push("/scheduled");
        return;
      }
    }

    if (matchesShortcut(event, ks.calendar.add_task)) {
      event.preventDefault();
      toggleDueDateModal("Create");
    }

    if (matchesShortcut(event, ks.calendar.previous_group)) {
      event.preventDefault();
      handlePrevious();
    }
    if (matchesShortcut(event, ks.calendar.next_group)) {
      event.preventDefault();
      handleNext();
    }
    if (matchesShortcut(event, ks.calendar.focus_today)) {
      event.preventDefault();
      handleDateSelect(new Date());
    }

    if (matchesShortcut(event, ks.calendar.month_view)) {
      event.preventDefault();
      setCurrentViewFromInteraction("month");
    }
    if (matchesShortcut(event, ks.calendar.week_view)) {
      event.preventDefault();
      setCurrentViewFromInteraction("week");
    }
    if (matchesShortcut(event, ks.calendar.day_view)) {
      event.preventDefault();
      setCurrentViewFromInteraction("day");
    }

    if ((event.keyCode === KeyCodes.CLOSE_BRACKET || event.keyCode === KeyCodes.OPEN_BRACKET) && cmdControl) {
      event.preventDefault();
      if (projects.length > 0) {
        if (currentProjectCycleIndexRef.current === -1) {
          currentProjectCycleIndexRef.current = 0;
          document.getElementById(projects[0].name)?.focus();
          return
        }
        const goTo = event.keyCode === KeyCodes.CLOSE_BRACKET ? 1 : -1;
        const nextIndex = (currentProjectCycleIndexRef.current + goTo + projects.length) % projects.length;
        currentProjectCycleIndexRef.current = nextIndex;
        document.getElementById(projects[nextIndex].name)?.focus();
      }
    }
    if (event.keyCode === KeyCodes.SPACE) {
      event.preventDefault();
      const projectToToggle = projects[currentProjectCycleIndexRef.current];
      // ponytail: the cycle index starts at -1, so Space before Ctrl+] has nothing to toggle.
      if (!projectToToggle) return;
      handleProjectToggle(projectToToggle.id, !checkedProjects[projectToToggle.id]);
    }

    if (event.keyCode === KeyCodes.F && event.shiftKey) {
      event.preventDefault();
      setShowFilterModal(true);
    }

    if (matchesShortcut(event, ks.calendar.go_back)) {
      event.preventDefault();
      // HTPR-4821: Escape used to call back() unconditionally, so on a tab whose
      // previous entry is outside the app it walked out of the SPA and left a
      // blank page. The Navigation API only lists same-origin entries, so a
      // current index above 0 means there is an in-app page to return to.
      const nav = (window as any).navigation;
      const canGoBackInApp =
        typeof nav?.currentEntry?.index === "number"
          ? nav.currentEntry.index > 0
          : window.history.length > 1;
      if (canGoBackInApp) router.back();
      return;
    }
  }, [
    showDueDateModal,
    currentTask,
    currentDay,
    tasks,
    shiftFocusHorizontally,
    shiftFocusVertically,
    moveTaskHorizontally,
    moveTaskVertically,
    toggleDueDateModal,
    toggleManageTasksModal,
    handleTaskClick,
    goToProjectShortcut,
    createTaskModal,
    projects,
    checkedProjects,
    handleProjectToggle,
    showFilterModal,
  ]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  useEffect(() => {
    // When view changes, recalculate currentDay and currentTask
    const allDaysInView = weeks.flat();
    const currentDayExists = allDaysInView.some((day) =>
      isSameDate(day, currentDay)
    );

    if (viewRef.current !== currentView || !currentDayExists) {
      // Helper function to get tasks for a date
      const getTasksForDateHelper = (date: Date) => {
        const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        return tasksByDate.get(dateKey) || [];
      };

      if (currentDayExists) {
        // Current day is in view, check if it has tasks
        const tasksForCurrentDay = getTasksForDateHelper(currentDay);
        if (tasksForCurrentDay.length > 0) {
          setCurrentTaskWithFocus(tasksForCurrentDay[0].id);
        } else {
          setCurrentTaskWithFocus(-1, currentDay);
        }
      } else {
        // Current day is not in view, find first task in weeks array
        let foundTask = false;
        let firstDayWithTask: Date | null = null;
        let firstTaskId: number | null = null;

        for (const day of allDaysInView) {
          const tasksForDay = getTasksForDateHelper(day);
          if (tasksForDay.length > 0) {
            firstDayWithTask = day;
            firstTaskId = tasksForDay[0].id;
            foundTask = true;
            break;
          }
        }

        if (foundTask && firstDayWithTask && firstTaskId !== null) {
          // Found a task, set currentDay and currentTask
          setCurrentDay(firstDayWithTask);
          setCurrentTaskWithFocus(firstTaskId);
        } else {
          // No tasks found, focus on the first day
          const firstDay = allDaysInView[0];
          if (firstDay) {
            setCurrentDay(firstDay);
            setCurrentTaskWithFocus(-1, firstDay);
          }
        }
      }

      viewRef.current = currentView;
    }
  }, [tasks, currentDay, tasksByDate, currentView, weeks]);

  useEffect(() => {
    if (
      !hasInitializedTaskRef.current &&
      tasksByDate.size > 0 &&
      currentTask === -1
    ) {
      const dateKey = `${currentDay.getFullYear()}-${currentDay.getMonth()}-${currentDay.getDate()}`;
      const tasksForCurrentDay = tasksByDate.get(dateKey) || [];
      if (tasksForCurrentDay.length > 0) {
        setCurrentTaskWithFocus(tasksForCurrentDay[0].id);
      }
      // Mark as initialized regardless of whether we found a task for current day
      // This prevents re-running when user intentionally sets currentTask to -1
      hasInitializedTaskRef.current = true;
    }
  }, [tasksByDate, currentDay, currentTask]);

  // Handle pending date selection after weeks recalculate
  useEffect(() => {
    if (pendingDateSelectRef.current) {
      const targetDate = pendingDateSelectRef.current;
      // Check if target date is now in the weeks array
      const allDaysInView = weeks.flat();
      const dateExistsInView = allDaysInView.some((day) =>
        isSameDate(day, targetDate)
      );

      if (dateExistsInView) {
        // Date is now in view, focus on it
        setCurrentDay(targetDate);

        // Focus on the day element
        const dayElement = document.getElementById(
          `day-${targetDate.toISOString()}`
        );
        if (dayElement) {
          dayElement.focus();
          dayElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }

        // Set current task to first task if any, or -1 if no tasks
        const tasksForDate = getTasksForDate(targetDate);
        setCurrentTaskWithFocus(
          tasksForDate.length > 0 ? tasksForDate[0].id : -1,
          targetDate
        );

        // Clear the pending date selection
        pendingDateSelectRef.current = null;
      }
    }
  }, [weeks, getTasksForDate]);

  const statesToReturn = {
    currentDate,
    currentView,
    currentDay,
    currentTask,
    weeks,
    tasks,
    projects,
    checkedProjects,
    taskFilters,
    calendarSort,
    calendarViews,
    appliedCalendarViewId,
    everythingTitle,
    calendarViewCounts,
    visibleTaskCount,
    isCalendarDataPending,
    calendarDataError,
    isCalendarViewDirty,
    showDueDateModal,
    showManageTasksModal,
    showFilterModal,
    filteredMembers,
    allTags,
    allAgents,
  };

  const functionsToReturn = {
    getTasksForDate,
    onDragEnd,
    onTaskUpdate,
    handlePrevious,
    handleNext,
    setCurrentView: setCurrentViewFromInteraction,
    setCurrentTask,
    handleDateSelect,
    handleProjectToggle,
    handleTaskFilterToggle,
    handleClearFilters,
    handleTaskClick,
    dueDateModalCallback,
    toggleDueDateModal,
    setCurrentDate,
    toggleManageTasksModal,
    toggleFilterModal,
    setCalendarSort: setCalendarSortFromInteraction,
    applyCalendarView,
    saveCalendarView,
    renameCalendarView,
    renameEverything,
    deleteCalendarView,
    resetEverything,
    resetCalendarView,
    reconcileCalendar,
    retryCalendarData,
  };

  return {
    ...statesToReturn,
    ...functionsToReturn,
  };
}
