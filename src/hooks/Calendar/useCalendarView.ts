import { buildCalendarTaskFilterSets, type CalendarTaskFilterSets } from "./calendarTaskFilters";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSetRecoilState, useRecoilValue, useRecoilState } from "@/lib/state";
import {
  tasksPlayListAtom,
  showCreateTaskModalAtom,
  currentViewAtom,
  calendarCheckedProjectsAtom,
  calendarTaskFiltersAtom,
  calendarSettingsAtom,
  calendarSortAtom,
} from "@/store";
import { useSyncedCalendarReadModel } from "./useSyncedCalendarReadModel";
import UpdateKanban from "../MultiPages/useUpdateTaskInBoards";
import { useProjectQuery } from "../General/useProjectQuery";
import useGetTimeOptions from "../General/useGetTimeOptions";
import { ITask } from "@/models/model";
import { useRouter } from "next/navigation";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { useAgents } from "@/hooks/MultiPages/useAgents";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchUserPreference,
  USER_PREFERENCES_QUERY_KEY,
  useGetUserPreferences,
  type IUserPreferences,
} from "@/hooks/General/useGetUserPreferences";
import {
  DEFAULT_CALENDAR_SETTINGS,
  DEFAULT_CALENDAR_TASK_FILTERS,
  DEFAULT_CALENDAR_VIEWS,
  sanitizeCalendarViewsPreference,
  type CalendarEverythingOverride,
  type CalendarSavedView,
  type CalendarViewCreateInput,
  type CalendarTaskFilters,
  type CalendarViewsOperation,
  type CalendarViewsPreference,
} from "@/models/Calendar/model";
import {
  clearCalendarSessionDraft,
  readCalendarSessionDraft,
  resolveCalendarSessionDraft,
  writeCalendarSessionDraft,
} from "@/lib/calendarSessionDraft";
import axios from "axios";
import toast from "react-hot-toast";
import type { ViewVisibility } from "@prisma/client";
import { materializeCalendarViewProjectIds } from "@/models/Calendar/visibility";
import { isTaskAssignedToMe } from "@/utils/helperFunctions/calendar.functions";
import { calendarConfig } from "@/lib/configs/ calendar.config";
import { useCalendarTasks } from "./useCalendarTasks";
import { useCalendarFocus, useCalendarNavigation, useCalendarFocusSync } from "./useCalendarFocus";
import { useCalendarTaskActions } from "./useCalendarTaskActions";
import { useCalendarDragDrop } from "./useCalendarDragDrop";
import { useCalendarKeyboard } from "./useCalendarKeyboard";

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

function useCalendarState({
  accountId,
}: { accountId: number }) {
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


  return {
    currentDate,
    setCurrentDate,
    currentView,
    setCurrentView,
    calendarSettings,
    setCalendarSettings,
    allData,
    projects,
    isCalendarDataPending,
    calendarDataError,
    retryCalendarData,
    reconcileCalendar,
    updateTaskProjection,
    currentDay,
    setCurrentDay,
    currentTask,
    setCurrentTask,
    viewRef,
    pendingDateSelectRef,
    hasInitializedTaskRef,
    lastGClickRef,
    currentProjectCycleIndexRef,
    urlBaselineSyncPending,
    urlDeepLinkRef,
    updateTaskInCache,
    updateActiveItemAndItemInView,
    goToProjectShortcut,
    setTaskPlayList,
    getDefaultOptions,
    showDueDateModal,
    setShowDueDateModal,
    showManageTasksModal,
    setShowManageTasksModal,
    showFilterModal,
    setShowFilterModal,
    router,
    isApple,
    createTaskModal,
    checkedProjects,
    setCheckedProjects,
    taskFilters,
    setTaskFilters,
    calendarSort,
    setCalendarSort,
    allAgents,
    queryClient,
    userPreferencesQuery,
    calendarViewsQueryKey,
    calendarViewsQuery,
    hasHydratedCalendarViews,
    hasInteractedWithCalendarState,
    skipNextCalendarSessionDraftWrite,
    calendarViewsWriteQueue,
    calendarViewsWriteVersion,
    calendarViewsNeedServerState,
    calendarViewsPreference,
    everythingTitle,
    calendarViews,
    appliedCalendarViewId,
  };
}

export type CalendarState = ReturnType<typeof useCalendarState>;

function useCalendarSync({
  accountId,
  setCurrentDate,
  currentView,
  setCurrentView,
  calendarSettings,
  setCalendarSettings,
  currentDay,
  setCurrentDay,
  urlBaselineSyncPending,
  urlDeepLinkRef,
  checkedProjects,
  setCheckedProjects,
  taskFilters,
  setTaskFilters,
  calendarSort,
  setCalendarSort,
  queryClient,
  userPreferencesQuery,
  calendarViewsQuery,
  hasHydratedCalendarViews,
  hasInteractedWithCalendarState,
  skipNextCalendarSessionDraftWrite,
  calendarViewsWriteQueue,
  calendarViewsWriteVersion,
  calendarViewsNeedServerState,
  calendarViewsPreference,
  calendarViews,
  appliedCalendarViewId,
}: { accountId: number } & Pick<
  CalendarState,
  "setCurrentDate"
  | "currentView"
  | "setCurrentView"
  | "calendarSettings"
  | "setCalendarSettings"
  | "currentDay"
  | "setCurrentDay"
  | "urlBaselineSyncPending"
  | "urlDeepLinkRef"
  | "checkedProjects"
  | "setCheckedProjects"
  | "taskFilters"
  | "setTaskFilters"
  | "calendarSort"
  | "setCalendarSort"
  | "queryClient"
  | "userPreferencesQuery"
  | "calendarViewsQuery"
  | "hasHydratedCalendarViews"
  | "hasInteractedWithCalendarState"
  | "skipNextCalendarSessionDraftWrite"
  | "calendarViewsWriteQueue"
  | "calendarViewsWriteVersion"
  | "calendarViewsNeedServerState"
  | "calendarViewsPreference"
  | "calendarViews"
  | "appliedCalendarViewId"
>) {
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

  return {
    applyCalendarViewState,
    persistCalendarViews,
    setCurrentViewFromInteraction,
    setCalendarSortFromInteraction,
    currentCalendarView,
  };
}

export type CalendarSyncState = ReturnType<typeof useCalendarSync>;

function useCalendarSavedViews({
  accountId,
  projects,
  queryClient,
  calendarViewsQueryKey,
  hasHydratedCalendarViews,
  hasInteractedWithCalendarState,
  skipNextCalendarSessionDraftWrite,
  calendarViewsPreference,
  calendarViews,
  appliedCalendarViewId,
  applyCalendarViewState,
  persistCalendarViews,
  currentCalendarView,
}: { accountId: number } & Pick<
  CalendarState,
  "projects"
  | "queryClient"
  | "calendarViewsQueryKey"
  | "hasHydratedCalendarViews"
  | "hasInteractedWithCalendarState"
  | "skipNextCalendarSessionDraftWrite"
  | "calendarViewsPreference"
  | "calendarViews"
  | "appliedCalendarViewId"
> & Pick<
  CalendarSyncState,
  "applyCalendarViewState"
  | "persistCalendarViews"
  | "currentCalendarView"
>) {
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

  return {
    applyCalendarView,
    saveCalendarView,
    renameCalendarView,
    renameEverything,
    deleteCalendarView,
    resetEverything,
    resetCalendarView,
    isCalendarViewDirty,
  };
}

export type CalendarSavedViewsState = ReturnType<typeof useCalendarSavedViews>;

function useCalendarFilters({
  accountId,
  taskFilters,
}: { accountId: number } & Pick<CalendarState, "taskFilters">) {
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

  return {
    taskMatchesFilters,
    taskFilterSets,
  };
}

export type CalendarFiltersState = ReturnType<typeof useCalendarFilters>;

function useCalendarTaskUpdates({
  reconcileCalendar,
  updateTaskProjection,
  updateTaskInCache,
}: Pick<CalendarState, "reconcileCalendar" | "updateTaskProjection" | "updateTaskInCache">) {
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

  return {
    onTaskUpdate,
  };
}

export type CalendarTaskUpdatesState = ReturnType<typeof useCalendarTaskUpdates>;

// Keep these calls in the original hook order so hydration and focus effects stay ordered.
export function useCalendarView(accountId: number) {
  const state = useCalendarState({ accountId });
  const sync = useCalendarSync({ accountId, ...state });
  const savedViews = useCalendarSavedViews({ accountId, ...state, ...sync });
  const filters = useCalendarFilters({ accountId, ...state });
  const taskData = useCalendarTasks({ ...state, ...filters });
  const focus = useCalendarFocus({ ...state, ...taskData });
  const taskUpdates = useCalendarTaskUpdates({ ...state });
  const taskActions = useCalendarTaskActions({
    ...state,
    ...taskData,
    ...focus,
    ...taskUpdates,
  });
  const navigation = useCalendarNavigation({ ...state, ...taskData, ...focus });
  const dragDrop = useCalendarDragDrop({ ...state, ...taskData, ...taskActions });
  useCalendarKeyboard({
    ...state,
    ...sync,
    ...taskData,
    ...focus,
    ...taskActions,
    ...navigation,
    ...dragDrop,
  });
  useCalendarFocusSync({ ...state, ...taskData, ...focus });

  const {
    currentDate,
    setCurrentDate,
    currentView,
    projects,
    isCalendarDataPending,
    calendarDataError,
    retryCalendarData,
    reconcileCalendar,
    currentDay,
    setCurrentDay,
    currentTask,
    setCurrentTask,
    showDueDateModal,
    showManageTasksModal,
    showFilterModal,
    checkedProjects,
    taskFilters,
    calendarSort,
    allAgents,
    everythingTitle,
    calendarViews,
    appliedCalendarViewId,
  } = state;
  const {
    setCurrentViewFromInteraction,
    setCalendarSortFromInteraction,
  } = sync;
  const {
    applyCalendarView,
    saveCalendarView,
    renameCalendarView,
    renameEverything,
    deleteCalendarView,
    resetEverything,
    resetCalendarView,
    isCalendarViewDirty,
  } = savedViews;
  const {
    filteredMembers,
    allTags,
    tasks,
    weeks,
    calendarViewCounts,
    visibleTaskCount,
    getTasksForDate,
  } = taskData;
  const {
    onTaskUpdate,
  } = taskUpdates;
  const {
    dueDateModalCallback,
    toggleFilterModal,
    toggleDueDateModal,
    handleTaskClick,
    toggleManageTasksModal,
  } = taskActions;
  const {
    handleDateSelect,
    handleProjectToggle,
    handleTaskFilterToggle,
    handleClearFilters,
    handlePrevious,
    handleNext,
  } = navigation;
  const {
    onDragEnd,
  } = dragDrop;

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
    setCurrentDay,
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
