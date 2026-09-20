"use client";

import BackButton from "@/components/Buttons/BackButton";
import { SplitTitle } from "@/components/Common/TaskRowComponents/TaskListRow";
import PriorityLabelComponent from "@/components/Modals/TaskPriority/PriorityLabelComponent";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import TableView from "@/components/PageComponents/Kanban/TableView/TableView";
import useClickOutside from "@/hooks/MultiPages/useClickOutside";
import { useFlag } from "@/hooks/useFlag";
import {
  MY_TASKS_FILTER_PARITY_FLAG,
  MY_TASKS_LIVE_UPDATES_FLAG,
  MY_TASKS_PRIORITY_FILTER_FLAG,
  MY_TASKS_SCOPES_FLAG,
  MY_TASKS_SNOOZE_FLAG,
  MY_TASKS_SHORTCUTS_WIDTH_FLAG,
  MY_TASKS_TABLE_COLUMNS_FLAG,
  MY_TASKS_TIME_GROUP_FLAG,
  MY_TASKS_QUICK_ADD_FLAG,
  MY_TASKS_OVERDUE_BADGES_FLAG,
  MY_TASKS_VIEWS_FLAG,
  MY_TASKS_BULK_SELECTION_FLAG,
  HTPR_6572_MY_TASKS_BOARD_TOOLBAR_FLAG,
} from "@/lib/flags/keys";
import {
  buildMyTasksListUrl,
  createMyTasksReconcileRunner,
  parseMyTasksListPayload,
} from "@/lib/myTasks/reconcileMyTasks";
import {
  MY_TASKS_QUICK_ADD_DEFAULT_BOARD_KEY,
  myTasksQuickAddTaskVisibleInPayload,
} from "@/lib/myTasks/quickAddHelpers";
import { useMyTasksRealtime } from "@/hooks/realtime/useMyTasksRealtime";
import { MyTasksBulkSelectionProvider } from "@/lib/contexts/MyTasks/BulkSelectionContext";
import MyTasksBulkActionBar from "@/components/PageComponents/MyTasks/MyTasksBulkActionBar";
import { PriorityConstants, type IPrioritiesConstants } from "@/lib/constants/constants";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import {
  myTasksAPIRoute,
  myTasksOverdueCountsAPIRoute,
  myTasksViewAPIRoute,
  myTasksViewsAPIRoute,
} from "@/lib/constants/APIRouteConstants";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { filterMyTasksByPriority } from "@/lib/myTasksFiltering";
import {
  applyMyTasksView,
  overdueCountForMyTasksView,
  sortMyTasksViewSections,
  type MyTasksTask,
} from "@/lib/myTasksFiltering";
import {
  getMyTasksSplitIndex,
  groupMyTasksByTime,
  splitTabOverdueCounts,
} from "@/lib/myTasksGrouping";
import {
  EMPTY_MY_TASKS_VIEW_OVERDUE_COUNTS,
  mergeActiveViewOverdueCounts,
  msUntilNextLocalMidnight,
  parseMyTasksViewOverdueCounts,
} from "@/lib/myTasksOverdueCountUtils";
import { browserTimeZone } from "@/lib/myTasksTimeZone";
import { effectiveMyTasksScopes } from "@/lib/myTasksScopes";
import type {
  MyTasksBoardMetadata,
  MyTasksSavedView,
  MyTasksViewConfig,
} from "@/models/MyTasksView";
import {
  DEFAULT_MY_TASKS_VIEW_CONFIG,
  effectiveMyTasksGroupBy,
  effectiveMyTasksTableVisibleColumns,
  myTasksTimeGroupOn,
  parseMyTasksViewConfig,
} from "@/models/MyTasksView";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import { ISection, IUser } from "@/models/model";
import {
  sortingModeLabel,
  type TBoardSortingViewMode,
} from "@/models/Views/model";
import { CommandMode } from "@/models/enums";
import { appShellRailAtom,
  myTasksTableColumnsPickerRequestAtom, showCommandsAtom } from "@/store";
import styles from "@/styles/search.module.scss";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Filter } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import MyTasksKanbanFilterModal from "./MyTasksKanbanFilterModal";
import {
  DEFAULT_MY_TASKS_TABLE_COLUMNS,
  MY_TASKS_TABLE_COLUMN_KEYS,
  MY_TASKS_TABLE_COLUMN_LABELS,
  normalizeMyTasksTableVisibleColumns,
} from "@/utils/helperFunctions/Views/TableColumnsHelperFunctions";
import TableColumnsPicker from "@/components/PageComponents/Kanban/TableView/TableColumnsPicker";
import MyTasksQuickAdd from "./MyTasksQuickAdd";
import MyTasksViewControls from "./MyTasksViewControls";
import MyTasksViewTabs from "./MyTasksViewTabs";
import BoardPriorityMode, {
  type ControlledSortingLevel,
} from "@/components/Modals/Kanban/BoardPriorityMode";
import type { SerializableFilterSettings } from "@/lib/filterSettingsMutations";
import {
  addFilterValue,
  emptyFilterSettings,
  migrateFlatFiltersToFilterSettings,
} from "@/lib/filterSettingsMutations";
import { useRunningTimers } from "@/hooks/Task Detail/useTimeTracking";
import type {
  CalendarLabelSummary,
  CalendarUserSummary,
} from "@/lib/calendarSync/contract";

interface IProps {
  sections: ISection[];
  tabs: string[];
  boards: MyTasksBoardMetadata[];
  /** Boards the session can open, including ones with zero My Tasks rows. */
  accessibleProjectIds?: number[];
  /** Soonest future snooze among hidden rows; client refreshes when it elapses. */
  nearestSnoozeUntil?: string | null;
  currentUser: IUser;
  initialViews: MyTasksSavedView[];
  initialViewId: number | null;
  viewsEnabled: boolean;
  /** Server 6455 check so the first paint is already time-grouped. */
  timeGroupEnabled?: boolean;
  scopesEnabled?: boolean;
}

const MY_TASKS_SORTING_MODE = "DueDate" as TBoardSortingViewMode;
const EMPTY_ACCESSIBLE_PROJECT_IDS: number[] = [];
const EMPTY_MY_TASKS_BOARDS: MyTasksBoardMetadata[] = [];
const EMPTY_MY_TASKS_VIEWS: MyTasksSavedView[] = [];

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : fallback;
};

const MY_TASKS_BOARD_SORT_MODE = "Board";
const MY_TASKS_BOARD_SORT_MODES = [
  "UpdatedAt",
  "Priority",
  "DueDate",
  "Title",
  "CreatedAt",
  MY_TASKS_BOARD_SORT_MODE,
  "Manual",
];
const MY_TASKS_TO_BOARD_SORT = {
  board: MY_TASKS_BOARD_SORT_MODE,
  dueDate: "DueDate",
  priority: "Priority",
  createdAt: "CreatedAt",
  updatedAt: "UpdatedAt",
  title: "Title",
} as const;
const BOARD_TO_MY_TASKS_SORT = {
  Board: "board",
  DueDate: "dueDate",
  Priority: "priority",
  CreatedAt: "createdAt",
  UpdatedAt: "updatedAt",
  Title: "title",
} as const;

export const toBoardSort = (
  sort: MyTasksViewConfig["sort"],
): ControlledSortingLevel => ({
  mode: MY_TASKS_TO_BOARD_SORT[sort.field],
  order: sort.direction === "asc" ? "Ascending" : "Descending",
});

export const fromBoardSort = (
  sort: ControlledSortingLevel | null,
): MyTasksViewConfig["sort"] => {
  if (!sort || sort.mode === "Manual" || !(sort.mode in BOARD_TO_MY_TASKS_SORT)) {
    return DEFAULT_MY_TASKS_VIEW_CONFIG.sort;
  }
  return {
    field: BOARD_TO_MY_TASKS_SORT[sort.mode as keyof typeof BOARD_TO_MY_TASKS_SORT],
    direction: sort.order === "Ascending" ? "asc" : "desc",
  };
};

const MyTasks = ({
  sections: initialSections,
  tabs: initialTabs,
  boards: initialBoards = EMPTY_MY_TASKS_BOARDS,
  accessibleProjectIds: initialAccessibleProjectIds = EMPTY_ACCESSIBLE_PROJECT_IDS,
  nearestSnoozeUntil: initialNearestSnoozeUntil = null,
  currentUser,
  initialViews = EMPTY_MY_TASKS_VIEWS,
  initialViewId = null,
  viewsEnabled = false,
  timeGroupEnabled = false,
  scopesEnabled = false,
}: IProps) => {
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const [showCommands, setShowCommands] = useRecoilState(showCommandsAtom);
  const router = useRouter();
  const searchParams = useSearchParams();
  const myTasksShortcutsWidthEnabled = useFlag(MY_TASKS_SHORTCUTS_WIDTH_FLAG);
  const boardParam = searchParams?.get("board") ?? null;
  const [sections, setSections] = useState(initialSections);
  const [tabs, setTabs] = useState(initialTabs);
  const [boards, setBoards] = useState(initialBoards);
  const [accessibleProjectIds, setAccessibleProjectIds] = useState(
    initialAccessibleProjectIds,
  );
  const [nearestSnoozeUntil, setNearestSnoozeUntil] = useState<string | null>(
    initialNearestSnoozeUntil,
  );
  const liveUpdatesEnabled = useFlag(MY_TASKS_LIVE_UPDATES_FLAG);
  const [activeSplit, setActiveSplit] = useState(() =>
    myTasksShortcutsWidthEnabled
      ? getMyTasksSplitIndex(initialSections, boardParam)
      : 0
  );

  const myTasksViewsEnabled = useFlag(MY_TASKS_VIEWS_FLAG);
  const myTasksTimeGroupFlag = useFlag(MY_TASKS_TIME_GROUP_FLAG);
  const myTasksTimeGroupEnabled = myTasksTimeGroupOn(
    timeGroupEnabled,
    Boolean(myTasksTimeGroupFlag),
  );
  const myTasksTableColumnsEnabled = useFlag(MY_TASKS_TABLE_COLUMNS_FLAG);
  const myTasksScopesFlag = useFlag(MY_TASKS_SCOPES_FLAG); // HTPR-6457 Involvement UI
  const myTasksSnoozeEnabled = useFlag(MY_TASKS_SNOOZE_FLAG);
  const myTasksQuickAddEnabled = useFlag(MY_TASKS_QUICK_ADD_FLAG);
  const overdueBadgesEnabled = useFlag(MY_TASKS_OVERDUE_BADGES_FLAG);
  const filterParityEnabled = useFlag(MY_TASKS_FILTER_PARITY_FLAG);
  const viewsFeatureEnabled = viewsEnabled && myTasksViewsEnabled;
  const tableColumnsFeatureEnabled =
    myTasksTableColumnsEnabled && viewsFeatureEnabled;
  const [kanbanFiltersOpen, setKanbanFiltersOpen] = useState(false);
  const { data: runningTimerEntries } = useRunningTimers();
  const viewParam = searchParams?.get("view") ?? null;
  const initialView = initialViews.find((view) => view.id === initialViewId);
  const [views, setViews] = useState(initialViews);
  const [activeViewId, setActiveViewId] = useState<number | null>(initialViewId);
  const [viewConfig, setViewConfig] = useState<MyTasksViewConfig>(() =>
    parseMyTasksViewConfig(initialView?.config ?? DEFAULT_MY_TASKS_VIEW_CONFIG),
  );
  const [viewBusy, setViewBusy] = useState(false);
  const [dateFilterVersion, setDateFilterVersion] = useState(0);
  const [remoteOverdueCounts, setRemoteOverdueCounts] = useState(
    EMPTY_MY_TASKS_VIEW_OVERDUE_COUNTS,
  );
  const [overdueCountsVersion, setOverdueCountsVersion] = useState(0);
  const overdueCountsFetchToken = useRef(0);
  const [columnsPickerOpen, setColumnsPickerOpen] = useState(false);
  const [columnsPickerRequest, setColumnsPickerRequest] = useRecoilState(
    myTasksTableColumnsPickerRequestAtom,
  );
  const lastColumnsPickerRequest = useRef(columnsPickerRequest);

  const filterEnabled = useFlag(MY_TASKS_PRIORITY_FILTER_FLAG);
  const myTasksBulkSelectionEnabled = useFlag(MY_TASKS_BULK_SELECTION_FLAG);
  const boardToolbarFlagEnabled = useFlag(HTPR_6572_MY_TASKS_BOARD_TOOLBAR_FLAG);
  const boardToolbarEnabled =
    boardToolbarFlagEnabled && viewsFeatureEnabled && filterParityEnabled;
  const [sortModalOpen, setSortModalOpen] = useState(false);
  const [runningOnly, setRunningOnly] = useState(false);
  const displayedSplit = boardToolbarEnabled ? 0 : activeSplit;
  // My Tasks spans every board, so unlike board filters (which persist to a
  // saved view) this selection lives in state only and resets on reload.
  const [prioritySelection, setPrioritySelection] = useState<
    IPrioritiesConstants[]
  >([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const saveRequestToken = useRef(0);
  const saveInFlight = useRef(false);
  const observedViewParam = useRef<string | null | undefined>(undefined);
  const scopesFetchToken = useRef(0);
  const lastFetchedScopesKey = useRef<string | null>(null);
  const updateViewConfig = useCallback(
    (next: MyTasksViewConfig | ((current: MyTasksViewConfig) => MyTasksViewConfig)) => {
      saveRequestToken.current += 1;
      setViewConfig(next);
    },
    [],
  );
  useClickOutside(filterRef, () => setFilterOpen(false));

  const scopesFeatureEnabled = Boolean(myTasksScopesFlag && scopesEnabled);
  const reconcileScopes = useMemo(
    () => effectiveMyTasksScopes(viewConfig.scopes, scopesFeatureEnabled),
    [scopesFeatureEnabled, viewConfig.scopes],
  );
  const scopesRef = useRef(reconcileScopes);
  scopesRef.current = reconcileScopes;
  const showSnoozed = Boolean(
    myTasksSnoozeEnabled && viewConfig.filters.showSnoozed,
  );
  const showSnoozedRef = useRef(showSnoozed);
  showSnoozedRef.current = showSnoozed;
  if (showSnoozedRef.current) {
    scopesRef.current = [
      ...reconcileScopes,
      "__showSnoozed" as (typeof reconcileScopes)[number],
    ];
  }
  const activeViewIdRef = useRef(activeViewId);
  activeViewIdRef.current = activeViewId;
  const reconcileRunner = useMemo(
    () =>
      createMyTasksReconcileRunner({
        fetchList: async (signal) => {
          const response = await fetch(buildMyTasksListUrl(scopesRef.current), {
            signal,
            cache: "no-store",
            credentials: "same-origin",
          });
          if (!response.ok) {
            throw new Error(
              await readError(response, "Unable to refresh My Tasks"),
            );
          }
          const payload = parseMyTasksListPayload(await response.json());
          if (!payload) throw new Error("Invalid My Tasks payload");
          return payload;
        },
        apply: (payload) => {
          setSections(payload.sections);
          setTabs(payload.tabs);
          setBoards(payload.boards);
          setAccessibleProjectIds(payload.accessibleProjectIds);
          if (payload.nearestSnoozeUntil !== undefined) {
            setNearestSnoozeUntil(payload.nearestSnoozeUntil ?? null);
          }
          setOverdueCountsVersion((version) => version + 1);
        },
        onError: () => {
          toast.error("Unable to refresh My Tasks");
        },
      }),
    [],
  );
  useEffect(() => () => reconcileRunner.cancel(), [reconcileRunner]);
  const onMyTasksReconcile = useCallback(() => {
    reconcileRunner.request();
  }, [reconcileRunner]);
  useMyTasksRealtime(
    currentUser.id,
    accessibleProjectIds,
    liveUpdatesEnabled,
    onMyTasksReconcile,
  );
  useEffect(() => {
    if (!liveUpdatesEnabled) return;
    reconcileRunner.request();
  }, [liveUpdatesEnabled, reconcileRunner, reconcileScopes.join(",")]);

  useEffect(() => {
    const onSnoozeChanged = () => reconcileRunner.request();
    window.addEventListener("my-tasks-snooze-changed", onSnoozeChanged);
    return () =>
      window.removeEventListener("my-tasks-snooze-changed", onSnoozeChanged);
  }, [reconcileRunner]);

  useEffect(() => {
    if (!overdueBadgesEnabled) return;
    const bumpOverdueCounts = () =>
      setOverdueCountsVersion((version) => version + 1);
    window.addEventListener("my-tasks-snooze-changed", bumpOverdueCounts);
    return () =>
      window.removeEventListener("my-tasks-snooze-changed", bumpOverdueCounts);
  }, [overdueBadgesEnabled]);

  useEffect(() => {
    if (!myTasksSnoozeEnabled) return;
    reconcileRunner.request();
  }, [myTasksSnoozeEnabled, reconcileRunner, showSnoozed]);

  useEffect(() => {
    if (!myTasksSnoozeEnabled || !nearestSnoozeUntil) return;
    const targetMs = new Date(nearestSnoozeUntil).getTime();
    if (!Number.isFinite(targetMs)) return;
    let cancelled = false;
    let timer: number | undefined;
    const schedule = () => {
      if (cancelled) return;
      const remaining = targetMs - Date.now();
      if (remaining <= 0) {
        reconcileRunner.request();
        return;
      }
      const delay = Math.max(250, Math.min(remaining + 50, 2147483647));
      timer = window.setTimeout(() => {
        if (remaining + 50 > 2147483647) {
          schedule();
          return;
        }
        reconcileRunner.request();
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [myTasksSnoozeEnabled, nearestSnoozeUntil, reconcileRunner]);

  const scopesKey = JSON.stringify(
    effectiveMyTasksScopes(viewConfig.scopes, Boolean(myTasksScopesFlag && scopesEnabled)),
  );

  useEffect(() => {
    // Only seed from SSR while we have not fetched a scopes selection yet.
    if (liveUpdatesEnabled) return;
    if (lastFetchedScopesKey.current !== null) return;
    setSections(initialSections);
    setTabs(initialTabs);
    setBoards(initialBoards);
    setAccessibleProjectIds(initialAccessibleProjectIds);
  }, [initialAccessibleProjectIds, initialBoards, initialSections, initialTabs, liveUpdatesEnabled]);

  useEffect(() => {
    // Invalidate any in-flight refetch before deciding whether to fetch.
    const token = ++scopesFetchToken.current;
    if (liveUpdatesEnabled) {
      // Live effect owns reconcile; only stop the legacy scopes-fetch token.
      return;
    }
    if (!myTasksScopesFlag || !scopesEnabled) {
      lastFetchedScopesKey.current = null;
      setSections(initialSections);
      setTabs(initialTabs);
      setBoards(initialBoards);
      setAccessibleProjectIds(initialAccessibleProjectIds);
      return;
    }
    // First paint already matches SSR for the active scopes; only refetch on change.
    if (lastFetchedScopesKey.current === null) {
      lastFetchedScopesKey.current = scopesKey;
      return;
    }
    if (lastFetchedScopesKey.current === scopesKey) return;
    const scopes = effectiveMyTasksScopes(viewConfig.scopes, true);
    if (showSnoozed) {
      scopes.push("__showSnoozed" as (typeof scopes)[number]);
    }
    void (async () => {
      try {
        const response = await fetch(
          `${myTasksAPIRoute}?scopes=${encodeURIComponent(scopes.join(","))}`,
        );
        if (token !== scopesFetchToken.current) return;
        if (!response.ok) {
          toast.error("Unable to refresh My Tasks");
          return;
        }
        const body = (await response.json()) as {
          sections?: ISection[];
          tabs?: string[];
          boards?: MyTasksBoardMetadata[];
          accessibleProjectIds?: number[];
          nearestSnoozeUntil?: string | null;
        };
        if (token !== scopesFetchToken.current) return;
        if (!Array.isArray(body.sections)) return;
        lastFetchedScopesKey.current = scopesKey;
        setSections(body.sections);
        if (Array.isArray(body.tabs)) setTabs(body.tabs);
        if (Array.isArray(body.boards)) setBoards(body.boards);
        if (Array.isArray(body.accessibleProjectIds)) {
          setAccessibleProjectIds(
            body.accessibleProjectIds.filter((id): id is number => typeof id === "number"),
          );
        }
        if (body.nearestSnoozeUntil !== undefined) {
          setNearestSnoozeUntil(body.nearestSnoozeUntil ?? null);
        }
      } catch {
        if (token === scopesFetchToken.current) {
          toast.error("Unable to refresh My Tasks");
        }
      }
    })();
  }, [
    initialAccessibleProjectIds,
    initialBoards,
    initialSections,
    initialTabs,
    liveUpdatesEnabled,
    myTasksScopesFlag,
    reconcileRunner,
    scopesEnabled,
    scopesKey,
    showSnoozed,
    viewConfig.scopes,
  ]);

  useEffect(() => {
    if (!viewsFeatureEnabled) return;
    const refreshDateFilters = () => setDateFilterVersion((version) => version + 1);
    window.addEventListener("focus", refreshDateFilters);
    return () => window.removeEventListener("focus", refreshDateFilters);
  }, [viewsFeatureEnabled]);

  useEffect(() => {
    if (!overdueBadgesEnabled) return;
    const refreshDateFilters = () => setDateFilterVersion((version) => version + 1);
    window.addEventListener("focus", refreshDateFilters);
    let timer: number | undefined;
    const scheduleMidnight = () => {
      timer = window.setTimeout(() => {
        refreshDateFilters();
        scheduleMidnight();
      }, msUntilNextLocalMidnight());
    };
    scheduleMidnight();
    return () => {
      window.removeEventListener("focus", refreshDateFilters);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [overdueBadgesEnabled]);

  const overdueViewsKey = JSON.stringify(
    views.map((view) => [view.id, view.config]),
  );
  const runningTaskIdsKey = Array.isArray(runningTimerEntries)
    ? runningTimerEntries
        .map((timer) => timer.taskId)
        .sort((a, b) => a - b)
        .join(",")
    : "";
  useEffect(() => {
    if (!overdueBadgesEnabled || !viewsFeatureEnabled) return;
    const timeZone = browserTimeZone();
    if (!timeZone) return;
    const token = ++overdueCountsFetchToken.current;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `${myTasksOverdueCountsAPIRoute}?timeZone=${encodeURIComponent(timeZone)}`,
          {
            cache: "no-store",
            credentials: "same-origin",
          },
        );
        if (!response.ok || cancelled || token !== overdueCountsFetchToken.current) {
          return;
        }
        const parsed = parseMyTasksViewOverdueCounts(await response.json());
        if (!parsed || cancelled || token !== overdueCountsFetchToken.current) {
          return;
        }
        setRemoteOverdueCounts(parsed);
      } catch {
        // Keep the last good counts; the active tab still overlays from sections.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    dateFilterVersion,
    overdueBadgesEnabled,
    overdueCountsVersion,
    overdueViewsKey,
    runningTaskIdsKey,
    viewsFeatureEnabled,
  ]);

  const activeView = views.find((view) => view.id === activeViewId);
  const baselineConfig = parseMyTasksViewConfig(
    activeView?.config ?? DEFAULT_MY_TASKS_VIEW_CONFIG,
  );
  const dirty = JSON.stringify(viewConfig) !== JSON.stringify(baselineConfig);
  const displayViewConfig = useMemo(() => {
    if (!runningOnly) return viewConfig;
    return {
      ...viewConfig,
      filterSettings: addFilterValue(
        viewConfig.filterSettings ?? emptyFilterSettings(),
        "RunningTimer",
        { id: 0 },
      ),
    };
  }, [runningOnly, viewConfig]);
  const displayFilterSettingsEnabled = filterParityEnabled || boardToolbarEnabled;

  // One gate for both control and behavior: if the flag flips off while a
  // selection exists, filtering stops too instead of hiding the control.
  const selectedPriorities = filterEnabled ? prioritySelection : [];
  const priorityFilteredSections = useMemo(
    () => filterMyTasksByPriority(sections, selectedPriorities),
    [sections, selectedPriorities]
  );

  const groupBy = effectiveMyTasksGroupBy(viewConfig, myTasksTimeGroupEnabled);

  const availableBoards = useMemo(() => {
    if (!viewConfig.boardIds) return boards;
    const selected = new Set(viewConfig.boardIds);
    return boards.filter((board) => selected.has(board.id));
  }, [boards, viewConfig.boardIds]);

  const boardSplitSources = useMemo(
    () => availableBoards.map((board) => ({ projectId: board.id })),
    [availableBoards],
  );

  const runtimeContext = useMemo(() => {
    if (!Array.isArray(runningTimerEntries)) return undefined;
    return {
      runningTaskIds: new Set(runningTimerEntries.map((timer) => timer.taskId)),
    };
  }, [runningTimerEntries]);

  const allTasksForBoardTabs = useMemo(() => {
    if (groupBy !== "time") return [];
    if (!viewsFeatureEnabled) {
      return priorityFilteredSections.flatMap(
        (section) => section.items as MyTasksTask[],
      );
    }
    const now = new Date();
    const selectedBoards = viewConfig.boardIds
      ? new Set(viewConfig.boardIds)
      : null;
    const flat = sections
      .filter(
        (section) =>
          !selectedBoards ||
          (section.projectId !== undefined && selectedBoards.has(section.projectId)),
      )
      .flatMap((section) => section.items as MyTasksTask[]);
    return applyMyTasksView(flat, displayViewConfig, now, {
      applyFilterSettings: displayFilterSettingsEnabled,
      runtimeContext,
    });
  }, [
    dateFilterVersion,
    displayFilterSettingsEnabled,
    displayViewConfig,
    groupBy,
    priorityFilteredSections,
    runtimeContext,
    sections,
    viewConfig,
    viewsFeatureEnabled,
  ]);

  const viewFilteredSections = useMemo(() => {
    const now = new Date();
    if (groupBy === "time") {
      const selectedBoardId =
        displayedSplit === 0
          ? null
          : availableBoards[displayedSplit - 1]?.id ?? null;
      const scopedTasks =
        selectedBoardId === null
          ? allTasksForBoardTabs
          : allTasksForBoardTabs.filter(
              (task) => (task.project?.id ?? task.projectId) === selectedBoardId,
            );
      return groupMyTasksByTime(scopedTasks, now).sections;
    }

    const selectedBoards = viewConfig.boardIds
      ? new Set(viewConfig.boardIds)
      : null;
    const boardSections = sections.filter(
      (section) =>
        !selectedBoards ||
        (section.projectId !== undefined && selectedBoards.has(section.projectId)),
    );
    const next = boardSections.map((section) => ({
      ...section,
      items: applyMyTasksView(
        section.items as MyTasksTask[],
        displayViewConfig,
        now,
        {
          applyFilterSettings: displayFilterSettingsEnabled,
          runtimeContext,
        },
      ),
    }));
    return sortMyTasksViewSections(next, viewConfig, now);
  }, [
    displayedSplit,
    allTasksForBoardTabs,
    availableBoards,
    dateFilterVersion,
    displayFilterSettingsEnabled,
    displayViewConfig,
    groupBy,
    runtimeContext,
    sections,
    viewConfig,
  ]);
  const filteredSections =
    viewsFeatureEnabled || groupBy === "time"
      ? viewFilteredSections
      : priorityFilteredSections;

  const activeTabs = useMemo(() => {
    if (groupBy === "time") {
      return ["All", ...availableBoards.map((board) => board.title)];
    }
    if (!viewsFeatureEnabled) return tabs;
    return ["All", ...filteredSections.map((section) => section.section_title)];
  }, [availableBoards, filteredSections, groupBy, tabs, viewsFeatureEnabled]);
  const activeBoardId = useRef<number | null>(
    groupBy === "time"
      ? availableBoards[activeSplit - 1]?.id ?? null
      : filteredSections[activeSplit - 1]?.projectId ?? null,
  );

  const totalCount = useMemo(() => {
    if (groupBy === "time") {
      return allTasksForBoardTabs.length;
    }
    return filteredSections.reduce(
      (total, section) => total + section.items.length,
      0,
    );
  }, [allTasksForBoardTabs.length, filteredSections, groupBy]);
  const visibleSections = useMemo(() => {
    if (groupBy === "time") return filteredSections;
    if (displayedSplit === 0) return filteredSections;
    const active = filteredSections[displayedSplit - 1];
    return active ? [active] : [];
  }, [displayedSplit, filteredSections, groupBy]);

  const replaceBoardParam = useCallback(
    (boardId: number | null) => {
      const next = new URLSearchParams(searchParams?.toString() ?? "");
      if (boardId === null) next.delete("board");
      else next.set("board", String(boardId));
      const query = next.toString();
      router.replace(`/my-tasks${query ? `?${query}` : ""}`, { scroll: false });
    },
    [router, searchParams]
  );

  const replaceParams = useCallback(
    (changes: { boardId?: null; viewId: number | null }) => {
      const next = new URLSearchParams(searchParams?.toString() ?? "");
      if (changes.boardId === null) next.delete("board");
      if (changes.viewId === null) next.set("view", "all");
      else next.set("view", String(changes.viewId));
      const query = next.toString();
      router.replace(`/my-tasks${query ? `?${query}` : ""}`, { scroll: false });
    },
    [router, searchParams],
  );

  const updateLegacySplit = useCallback(
    (index: number) => {
      const nextIndex = Math.max(0, Math.min(index, tabs.length - 1));
      setActiveSplit(nextIndex);
      if (myTasksShortcutsWidthEnabled) {
        replaceBoardParam(sections[nextIndex - 1]?.projectId ?? null);
      }
    },
    [myTasksShortcutsWidthEnabled, replaceBoardParam, sections, tabs.length]
  );

  const updateSplit = useCallback(
    (index: number) => {
      if (groupBy !== "time" && !viewsFeatureEnabled) {
        updateLegacySplit(index);
        return;
      }
      const nextIndex = Math.max(0, Math.min(index, activeTabs.length - 1));
      if (groupBy === "time") {
        const nextBoardId = availableBoards[nextIndex - 1]?.id ?? null;
        activeBoardId.current = nextBoardId;
        setActiveSplit(nextIndex);
        if (myTasksShortcutsWidthEnabled) {
          replaceBoardParam(nextBoardId);
        }
        return;
      }
      activeBoardId.current = filteredSections[nextIndex - 1]?.projectId ?? null;
      setActiveSplit(nextIndex);
      if (myTasksShortcutsWidthEnabled) {
        replaceBoardParam(filteredSections[nextIndex - 1]?.projectId ?? null);
      }
    },
    [
      activeTabs.length,
      availableBoards,
      filteredSections,
      groupBy,
      myTasksShortcutsWidthEnabled,
      replaceBoardParam,
      updateLegacySplit,
      viewsFeatureEnabled,
    ],
  );

  useEffect(() => {
    if (!myTasksShortcutsWidthEnabled) return;
    const sources = groupBy === "time" ? boardSplitSources : sections;
    setActiveSplit(getMyTasksSplitIndex(sources, boardParam));
  }, [boardParam, boardSplitSources, groupBy, myTasksShortcutsWidthEnabled, sections]);

  useEffect(() => {
    if (groupBy === "time") {
      if (!myTasksShortcutsWidthEnabled) {
        const split = getMyTasksSplitIndex(
          boardSplitSources,
          activeBoardId.current === null ? null : String(activeBoardId.current),
        );
        activeBoardId.current = availableBoards[split - 1]?.id ?? null;
        setActiveSplit(split);
        return;
      }
      const split = getMyTasksSplitIndex(boardSplitSources, boardParam);
      activeBoardId.current = availableBoards[split - 1]?.id ?? null;
      setActiveSplit(split);
      if (boardParam && split === 0) replaceBoardParam(null);
      return;
    }
    if (!viewsFeatureEnabled) return;
    if (!myTasksShortcutsWidthEnabled) {
      const split = getMyTasksSplitIndex(
        filteredSections,
        activeBoardId.current === null ? null : String(activeBoardId.current),
      );
      activeBoardId.current = filteredSections[split - 1]?.projectId ?? null;
      setActiveSplit(split);
      return;
    }
    const split = getMyTasksSplitIndex(filteredSections, boardParam);
    activeBoardId.current = filteredSections[split - 1]?.projectId ?? null;
    setActiveSplit(split);
    if (boardParam && split === 0) replaceBoardParam(null);
  }, [
    availableBoards,
    boardParam,
    boardSplitSources,
    filteredSections,
    groupBy,
    myTasksShortcutsWidthEnabled,
    replaceBoardParam,
    viewsFeatureEnabled,
  ]);

  useEffect(() => {
    if (!viewsFeatureEnabled || observedViewParam.current === viewParam) return;
    observedViewParam.current = viewParam;
    if (!viewParam) {
      if (activeViewId !== null) replaceParams({ viewId: activeViewId });
      return;
    }

    const requestedView = views.find((view) => String(view.id) === viewParam);
    if (!requestedView) {
      setActiveViewId(null);
      updateViewConfig(parseMyTasksViewConfig(DEFAULT_MY_TASKS_VIEW_CONFIG));
      replaceParams({ viewId: null });
      return;
    }
    setActiveViewId(requestedView.id);
    updateViewConfig(parseMyTasksViewConfig(requestedView.config));
    setFilterOpen(false);
  }, [activeViewId, replaceParams, updateViewConfig, viewParam, views, viewsFeatureEnabled]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.key === "Escape" &&
        !showCommands.show &&
        !returnIfModalOrInputActive()
      ) {
        event.preventDefault();
        if (filterOpen) {
          setFilterOpen(false);
          return;
        }
        router.back();
        return;
      }
      if (
        boardToolbarEnabled ||
        event.key !== "Tab" ||
        activeTabs.length === 0 ||
        returnIfModalOrInputActive()
      ) {
        return;
      }

      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      updateSplit(
        (activeSplit + direction + activeTabs.length) % activeTabs.length,
      );
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeSplit, activeTabs.length, boardToolbarEnabled, filterOpen, router, showCommands.show, updateSplit]);

  const selectView = (viewId: number | null) => {
    const view = views.find((candidate) => candidate.id === viewId);
    const nextConfig = parseMyTasksViewConfig(
      view?.config ?? DEFAULT_MY_TASKS_VIEW_CONFIG,
    );
    setActiveViewId(view?.id ?? null);
    updateViewConfig(nextConfig);
    setFilterOpen(false);
    const currentBoardId = boardParam ? Number(boardParam) : null;
    const boardStillVisible =
      currentBoardId === null ||
      nextConfig.boardIds === null ||
      nextConfig.boardIds.includes(currentBoardId);
    replaceParams({
      viewId: view?.id ?? null,
      ...(!boardStillVisible ? { boardId: null } : {}),
    });
  };

  const createView = async (name: string) => {
    setViewBusy(true);
    try {
      const response = await fetch(myTasksViewsAPIRoute, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, config: viewConfig }),
      });
      if (!response.ok) throw new Error(await readError(response, "Unable to create view"));
      const body = (await response.json()) as { view: MyTasksSavedView };
      const created = { ...body.view, config: parseMyTasksViewConfig(body.view.config) };
      setViews((current) => [...current, created]);
      setActiveViewId(created.id);
      updateViewConfig(created.config);
      replaceParams({ viewId: created.id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create view");
    } finally {
      setViewBusy(false);
    }
  };

  const patchView = async (
    viewId: number,
    update: Partial<Pick<MyTasksSavedView, "name" | "isDefault" | "config">>,
  ): Promise<MyTasksSavedView> => {
    const response = await fetch(myTasksViewAPIRoute(viewId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    if (!response.ok) throw new Error(await readError(response, "Unable to update view"));
    const body = (await response.json()) as { view: MyTasksSavedView };
    return { ...body.view, config: parseMyTasksViewConfig(body.view.config) };
  };

  const persistQuickAddDefaultBoard = useCallback(
    async (viewId: number | null, defaultBoardId: number) => {
      if (viewId === null) {
        try {
          localStorage.setItem(
            `${MY_TASKS_QUICK_ADD_DEFAULT_BOARD_KEY}:${currentUser.id}`,
            String(defaultBoardId),
          );
        } catch {
          // Ignore quota / private-mode failures; in-memory config still updates.
        }
        updateViewConfig((current) => ({ ...current, defaultBoardId }));
        return;
      }
      const response = await fetch(myTasksViewAPIRoute(viewId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configPatch: { defaultBoardId } }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Unable to update view"));
      }
      const body = (await response.json()) as { view: MyTasksSavedView };
      const saved = {
        ...body.view,
        config: parseMyTasksViewConfig(body.view.config),
      };
      setViews((current) =>
        current.map((view) => (view.id === saved.id ? saved : view)),
      );
      if (activeViewIdRef.current === viewId) {
        updateViewConfig((current) => ({ ...current, defaultBoardId }));
      }
    },
    [currentUser.id, updateViewConfig],
  );

  const quickAddVisibilityRef = useRef({
    viewConfig,
    viewsFeatureEnabled,
    filterParityEnabled,
    groupBy,
    activeSplit,
    prioritySelection,
    filterEnabled,
    runtimeContext,
  });
  quickAddVisibilityRef.current = {
    viewConfig,
    viewsFeatureEnabled,
    filterParityEnabled,
    groupBy,
    activeSplit,
    prioritySelection,
    filterEnabled,
    runtimeContext,
  };

  const refreshMyTasksAfterQuickAdd = useCallback(
    async (taskId: number) => {
      const payload = await reconcileRunner.flush();
      if (!payload) return false;
      return myTasksQuickAddTaskVisibleInPayload(
        payload,
        taskId,
        quickAddVisibilityRef.current,
      );
    },
    [reconcileRunner],
  );

  const saveView = async () => {
    if (!activeView || saveInFlight.current) return;
    saveInFlight.current = true;
    const requestToken = ++saveRequestToken.current;
    setViewBusy(true);
    try {
      const saved = await patchView(activeView.id, { config: viewConfig });
      setViews((current) =>
        current.map((view) => (view.id === saved.id ? saved : view)),
      );
      if (requestToken !== saveRequestToken.current) return;
      setViewConfig(saved.config);
    } catch (error) {
      if (requestToken === saveRequestToken.current) {
        toast.error(error instanceof Error ? error.message : "Unable to save view");
      }
    } finally {
      saveInFlight.current = false;
      setViewBusy(false);
    }
  };

  const renameView = async (viewId: number, name: string) => {
    setViewBusy(true);
    try {
      const saved = await patchView(viewId, { name });
      setViews((current) =>
        current.map((view) => (view.id === saved.id ? saved : view)),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to rename view");
    } finally {
      setViewBusy(false);
    }
  };

  const setDefaultView = async (viewId: number) => {
    setViewBusy(true);
    try {
      const saved = await patchView(viewId, { isDefault: true });
      setViews((current) =>
        current.map((view) => ({
          ...(view.id === saved.id ? saved : view),
          isDefault: view.id === saved.id,
        })),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to set default view");
    } finally {
      setViewBusy(false);
    }
  };

  const deleteView = async (viewId: number) => {
    setViewBusy(true);
    try {
      const response = await fetch(myTasksViewAPIRoute(viewId), {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await readError(response, "Unable to delete view"));
      setViews((current) => current.filter((view) => view.id !== viewId));
      if (activeViewId === viewId) {
        setActiveViewId(null);
        updateViewConfig(parseMyTasksViewConfig(DEFAULT_MY_TASKS_VIEW_CONFIG));
        replaceParams({ viewId: null });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete view");
    } finally {
      setViewBusy(false);
    }
  };

  const resetView = () => updateViewConfig(baselineConfig);
  const updateViewSort = useCallback(
    (sort: MyTasksViewConfig["sort"]) =>
      updateViewConfig((current) => ({ ...current, sort })),
    [updateViewConfig],
  );
  const toggleRunningOnly = useCallback(() => {
    setRunningOnly((current) => !current);
  }, []);
  const openFilters = useCallback(() => {
    updateViewConfig((current) =>
      migrateFlatFiltersToFilterSettings(
        current,
        new Map(
          boards.flatMap((board) =>
            board.labels.map((label) => [label.id, label.name] as const),
          ),
        ),
      ),
    );
    setKanbanFiltersOpen(true);
  }, [boards, updateViewConfig]);
  useEffect(() => {
    if (!boardToolbarEnabled) return;
    const openMyTasksFilters = () => openFilters();
    const openMyTasksSort = () => setSortModalOpen(true);
    window.addEventListener("my-tasks-open-filters", openMyTasksFilters);
    window.addEventListener("my-tasks-open-sort", openMyTasksSort);
    return () => {
      window.removeEventListener("my-tasks-open-filters", openMyTasksFilters);
      window.removeEventListener("my-tasks-open-sort", openMyTasksSort);
    };
  }, [boardToolbarEnabled, openFilters]);
  const saveFromToolbar = useCallback(() => {
    if (activeView) {
      void saveView();
      return;
    }
    const name = window.prompt("Name this view")?.trim();
    if (name) void createView(name);
  }, [activeView, createView, saveView]);

  const openTableColumnsPicker = useCallback(() => {
    if (!tableColumnsFeatureEnabled) return;
    setColumnsPickerOpen(true);
  }, [tableColumnsFeatureEnabled]);
  const updateTableVisibleColumns = useCallback(
    (columns: string[]) => {
      updateViewConfig((current) => ({
        ...current,
        tableVisibleColumns: normalizeMyTasksTableVisibleColumns(columns),
      }));
    },
    [updateViewConfig],
  );
  const myTasksVisibleColumns = tableColumnsFeatureEnabled
    ? effectiveMyTasksTableVisibleColumns(viewConfig)
    : undefined;

  useEffect(() => {
    if (!tableColumnsFeatureEnabled) return;
    if (columnsPickerRequest === lastColumnsPickerRequest.current) return;
    lastColumnsPickerRequest.current = columnsPickerRequest;
    setColumnsPickerOpen(true);
  }, [columnsPickerRequest, tableColumnsFeatureEnabled]);

  useEffect(() => {
    if (tableColumnsFeatureEnabled) return;
    if (columnsPickerRequest === 0) return;
    setColumnsPickerRequest(0);
    lastColumnsPickerRequest.current = 0;
  }, [columnsPickerRequest, setColumnsPickerRequest, tableColumnsFeatureEnabled]);

const boardTabCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const task of allTasksForBoardTabs) {
      const boardId = task.project?.id ?? task.projectId;
      counts.set(boardId, (counts.get(boardId) ?? 0) + 1);
    }
    return counts;
  }, [allTasksForBoardTabs]);

  const tabLength = (index: number) => {
    if (groupBy === "time") {
      if (index === 0) return allTasksForBoardTabs.length;
      const boardId = availableBoards[index - 1]?.id;
      if (boardId === undefined) return 0;
      return boardTabCounts.get(boardId) ?? 0;
    }
    return index === 0 ? totalCount : filteredSections[index - 1]?.items.length ?? 0;
  };

  const viewOverdueCounts = useMemo(() => {
    if (!overdueBadgesEnabled || !viewsFeatureEnabled) {
      return EMPTY_MY_TASKS_VIEW_OVERDUE_COUNTS;
    }
    const now = new Date();
    const options = {
      applyFilterSettings: displayFilterSettingsEnabled,
      runtimeContext,
    };
    const activeCount = overdueCountForMyTasksView(
      sections,
      displayViewConfig,
      now,
      options,
    );
    return mergeActiveViewOverdueCounts(
      remoteOverdueCounts,
      activeViewId,
      activeCount,
    );
  }, [
    activeViewId,
    dateFilterVersion,
    displayFilterSettingsEnabled,
    displayViewConfig,
    overdueBadgesEnabled,
    remoteOverdueCounts,
    runtimeContext,
    sections,
    viewConfig,
    viewsFeatureEnabled,
  ]);

  const splitOverdueCounts = useMemo(() => {
    if (!overdueBadgesEnabled) return [] as number[];
    return splitTabOverdueCounts(
      groupBy,
      allTasksForBoardTabs,
      availableBoards,
      filteredSections,
      new Date(),
    );
  }, [
    allTasksForBoardTabs,
    availableBoards,
    dateFilterVersion,
    filteredSections,
    groupBy,
    overdueBadgesEnabled,
  ]);

  const tabOverdue = (index: number) =>
    overdueBadgesEnabled ? (splitOverdueCounts[index] ?? 0) : 0;

  const togglePriority = (priority: IPrioritiesConstants) =>
    setPrioritySelection((current) =>
      current.some((p) => p.priority_index === priority.priority_index)
        ? current.filter((p) => p.priority_index !== priority.priority_index)
        : [...current, priority]
    );

  const splitTitles = activeTabs.map((item, index) => (
    <SplitTitle
      key={`split-my-tasks-${index}`}
      isSelected={activeSplit === index}
      onClick={() => updateSplit(index)}
      tab={{
        idx: index,
        project: item,
        length: tabLength(index),
        hasUnseen: false,
        overdueCount: tabOverdue(index),
      }}
    />
  ));

  const content = (
    <div
      suppressHydrationWarning
      className={`py-9 h-screen min-h-0 overflow-hidden bg-containerBackground flex-col rounded-[4px] my-0 ${myTasksShortcutsWidthEnabled ? "w-full" : "global-view-width"} flex linksModal ${styles.links_modal}`}
    >
      {boardToolbarFlagEnabled && viewsFeatureEnabled && filterParityEnabled ? (
        <div className="pills-row mb-4 flex w-full min-w-0 items-start gap-3 px-4 @md:!px-20">
          {viewsEnabled && myTasksViewsEnabled ? (
            <MyTasksViewTabs
              views={views}
              activeViewId={activeViewId}
              dirty={dirty}
              busy={viewBusy}
              onSelect={selectView}
              onSave={() => void saveView()}
              onReset={resetView}
              onSaveAs={(name) => void createView(name)}
              onRename={(viewId, name) => void renameView(viewId, name)}
              onDelete={(viewId) => void deleteView(viewId)}
              onSetDefault={(viewId) => void setDefaultView(viewId)}
              overdueAll={viewOverdueCounts.all}
              overdueByViewId={viewOverdueCounts.byViewId}
              boardToolbar
            />
          ) : (
            <div className="min-w-0 flex-1" />
          )}
          <MyTasksViewControls
            boards={boards}
            config={viewConfig}
            onChange={updateViewConfig}
            scopesEnabled={scopesEnabled}
            snoozeEnabled={myTasksSnoozeEnabled}
            boardToolbar
            dirty={dirty}
            busy={viewBusy}
            runningOnly={runningOnly}
            runningTimerCount={runningTimerEntries?.length ?? 0}
            onSaveView={saveFromToolbar}
            onResetView={resetView}
            onOpenKanbanFilters={() =>
              setShowCommands({ show: true, mode: CommandMode.ShowFilterHTC })
            }
            onOpenSort={() =>
              setShowCommands({ show: true, mode: CommandMode.SortKanbanBoard })
            }
            onToggleRunningOnly={toggleRunningOnly}
            onOpenMenu={() =>
              setShowCommands({ show: true, mode: CommandMode.Command })
            }
          />
        </div>
      ) : viewsEnabled && myTasksViewsEnabled ? (
        <div className="mb-4 px-[16px] @md:!px-[78px]">
          <MyTasksViewTabs
            views={views}
            activeViewId={activeViewId}
            dirty={dirty}
            busy={viewBusy}
            onSelect={selectView}
            onSave={() => void saveView()}
            onReset={resetView}
            onSaveAs={(name) => void createView(name)}
            onRename={(viewId, name) => void renameView(viewId, name)}
            onDelete={(viewId) => void deleteView(viewId)}
            onSetDefault={(viewId) => void setDefaultView(viewId)}
            overdueAll={viewOverdueCounts.all}
            overdueByViewId={viewOverdueCounts.byViewId}
          />
        </div>
      ) : null}

      <div className="flex gap-2 px-[16px] @md:!px-[88px]">
        <span className="flex items-baseline gap-2 font-bold text-subheading text-white-black">
          <p>My Tasks</p>
          <span className="text-content font-normal text-text-light-gray">
            {totalCount}
          </span>
          {liveUpdatesEnabled ? (
            <span className="sr-only">Live list updates on</span>
          ) : null}
          {myTasksTimeGroupFlag ? (
            <span className="hidden" data-htpr-6455-my-tasks-time-group aria-hidden />
          ) : null}
        </span>
        {!boardToolbarEnabled &&
          ((viewsEnabled && myTasksViewsEnabled) || myTasksTimeGroupEnabled) && (
          <MyTasksViewControls
            boards={boards}
            config={viewConfig}
            onChange={updateViewConfig}
            timeGroupEnabled={myTasksTimeGroupEnabled}
            tableColumnsEnabled={tableColumnsFeatureEnabled}
            scopesEnabled={scopesEnabled}
            snoozeEnabled={myTasksSnoozeEnabled}
            onOpenTableColumns={openTableColumnsPicker}
            onOpenKanbanFilters={() => {
              updateViewConfig((current) =>
                migrateFlatFiltersToFilterSettings(
                  current,
                  new Map(
                    boards.flatMap((board) =>
                      board.labels.map((label) => [label.id, label.name] as const),
                    ),
                  ),
                ),
              );
              setKanbanFiltersOpen(true);
            }}
          />
        )}
        {!boardToolbarEnabled && myTasksSnoozeEnabled && !viewsFeatureEnabled ? (
          <label className="ml-auto flex items-center gap-2 self-center text-content text-text-light-gray">
            <input
              type="checkbox"
              checked={showSnoozed}
              onChange={() =>
                updateViewConfig((current) => ({
                  ...current,
                  filters: {
                    ...current.filters,
                    showSnoozed: !current.filters.showSnoozed,
                  },
                }))
              }
            />
            Show snoozed
          </label>
        ) : null}
        {!boardToolbarEnabled && filterEnabled && (
          !viewsFeatureEnabled ? (
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
          ) : null
        )}
      </div>

      {!boardToolbarEnabled && (
      <div className="hidden @md:block w-full overflow-x-auto scrollbar-none no-scrollbar @md:px-[78px] @lg:px-[73px] mt-4">
        <div className="flex flex-wrap grow">{splitTitles}</div>
      </div>
      )}

      <div className="mt-3 flex-1 min-h-0 w-full">
        {myTasksQuickAddEnabled && !boardToolbarEnabled ? (
          <MyTasksQuickAdd
            currentUser={currentUser}
            activeViewId={activeViewId}
            viewConfig={viewConfig}
            scopes={reconcileScopes}
            accessibleProjectIds={accessibleProjectIds}
            onPersistDefaultBoard={persistQuickAddDefaultBoard}
            onRefresh={refreshMyTasksAfterQuickAdd}
          />
        ) : null}
        <MyTasksBulkSelectionProvider
          enabled={myTasksBulkSelectionEnabled}
          resetSelectionKey={`${activeViewId ?? "all"}:${displayedSplit}:${prioritySelection
            .map((priority) => priority.priority_index)
            .join(",")}`}
          onAfterMutation={() => reconcileRunner.request()}
        >
        <TableView
          filteredSections={visibleSections}
          _sections={visibleSections}
          _currentProject={null}
          _activeSortingMode={MY_TASKS_SORTING_MODE}
          currentUser={currentUser}
          myTasksSort={viewsFeatureEnabled ? viewConfig.sort : undefined}
          myTasksSortKey={activeViewId}
          myTasksSnoozeActive={myTasksSnoozeEnabled}
          onMyTasksSortChange={viewsFeatureEnabled ? updateViewSort : undefined}
          myTasksVisibleColumns={myTasksVisibleColumns}
          onMyTasksVisibleColumnsChange={
            tableColumnsFeatureEnabled ? updateTableVisibleColumns : undefined
          }
          enableMyTasksBulkSelection={myTasksBulkSelectionEnabled}
        />
        {myTasksBulkSelectionEnabled ? <MyTasksBulkActionBar /> : null}
        </MyTasksBulkSelectionProvider>
      </div>

      {!boardToolbarEnabled ? (
        <div className="flex inbox_footer @md:hidden no-scrollbar scrollbar-none @md:gap-8 w-100 bg-hoverCardBackground h-20 @md:h-8 inbox_title">
          {splitTitles}
        </div>
      ) : null}
      {myTasksTableColumnsEnabled && tableColumnsFeatureEnabled && columnsPickerOpen ? (
        <TableColumnsPicker
          closeHandler={() => setColumnsPickerOpen(false)}
          availableColumns={MY_TASKS_TABLE_COLUMN_KEYS}
          columnLabels={MY_TASKS_TABLE_COLUMN_LABELS}
          value={myTasksVisibleColumns}
          onChange={updateTableVisibleColumns}
          defaultColumns={DEFAULT_MY_TASKS_TABLE_COLUMNS}
          normalize={normalizeMyTasksTableVisibleColumns}
          hideCustomFields
          hideWidthReset
        />
      ) : null}
    </div>
  );


  const myTasksFilterMembers = useMemo<CalendarUserSummary[]>(() => {
    const map = new Map<number, CalendarUserSummary>();
    for (const board of boards) {
      for (const member of board.members ?? []) {
        map.set(member.id, {
          id: member.id,
          displayName: member.displayName,
          photoURL: member.photoURL,
        });
      }
    }
    return [...map.values()];
  }, [boards]);

  const myTasksFilterLabels = useMemo<CalendarLabelSummary[]>(() => {
    return boards.flatMap((board) =>
      board.labels.map((label) => ({
        id: label.id,
        value: label.name,
        projectId: board.id,
      })),
    );
  }, [boards]);

  const onFilterSettingsChange = useCallback(
    (next: SerializableFilterSettings) => {
      updateViewConfig((current) => {
        const hasStarredFilter = next.addedFilters.some(
          (filter) => filter.type === "Starred",
        );
        // Keep flat not-starred across ordinary edits; Clear All uses onClearAllFilters.
        // Explicit Starred in filterSettings replaces it.
        const keepNotStarred =
          current.filters.starred === false && !hasStarredFilter;
        return {
          ...current,
          // FilterHTC owns these overlapping fields once parity is in use.
          filters: {
            ...current.filters,
            priorityIds: [],
            labelIds: [],
            sizeIds: [],
            starred: keepNotStarred ? false : null,
            dueDate: null,
            createdRange: null,
            updatedRange: null,
          },
          filterSettings: next,
        };
      });
    },
    [updateViewConfig],
  );

  const onClearAllFilters = useCallback(() => {
    updateViewConfig((current) => ({
      ...current,
      boardIds: null,
      filters: {
        ...current.filters,
        priorityIds: [],
        labelIds: [],
        sizeIds: [],
        starred: null,
        dueDate: null,
        createdRange: null,
        updatedRange: null,
        sectionIds: [],
        showDone: false,
        showSnoozed: false,
      },
      filterSettings: emptyFilterSettings(),
    }));
  }, [updateViewConfig]);

  const onClearNotStarred = useCallback(() => {
    updateViewConfig((current) => ({
      ...current,
      filters: {
        ...current.filters,
        starred: null,
      },
    }));
  }, [updateViewConfig]);

  return (
    <>
      {appShellRailOn && (
        <AppShellRail variant="global" currentUser={currentUser} />
      )}
      {appShellRailOn ? (
        <div
          className={
            myTasksShortcutsWidthEnabled
              ? "ml-[var(--app-shell-rail-w,48px)] w-[calc(100%-var(--app-shell-rail-w,48px))]"
              : "pl-[var(--app-shell-rail-w,48px)]"
          }
        >
          {content}
        </div>
      ) : (
        content
      )}
      <BackButton left={appShellRailOn ? 56 : undefined} />
      {boardToolbarEnabled && sortModalOpen ? (
        <BoardPriorityMode
          closeHandler={() => setSortModalOpen(false)}
          sort={toBoardSort(viewConfig.sort)}
          onSortChange={(sort) => updateViewSort(fromBoardSort(sort))}
          maxLevels={1}
          availableModes={MY_TASKS_BOARD_SORT_MODES}
          modeLabel={(mode) =>
            mode === MY_TASKS_BOARD_SORT_MODE
              ? "Board"
              : sortingModeLabel(mode as TBoardSortingViewMode)
          }
        />
      ) : null}
      {filterParityEnabled && kanbanFiltersOpen && (
        <MyTasksKanbanFilterModal
          settings={viewConfig.filterSettings}
          onChange={onFilterSettingsChange}
          onClearAll={onClearAllFilters}
          notStarred={viewConfig.filters.starred === false}
          onClearNotStarred={onClearNotStarred}
          members={myTasksFilterMembers}
          labels={myTasksFilterLabels}
          scopes={effectiveMyTasksScopes(viewConfig.scopes, scopesFeatureEnabled)}
          involvementEnabled={boardToolbarEnabled && scopesFeatureEnabled}
          onScopesChange={(scopes) =>
            updateViewConfig((current) => ({ ...current, scopes }))
          }
          boards={boards}
          config={viewConfig}
          onConfigChange={updateViewConfig}
          snoozeEnabled={myTasksSnoozeEnabled}
          showScopeFilters={boardToolbarEnabled}
          onClose={() => setKanbanFiltersOpen(false)}
        />
      )}
    </>
  );
};

export default MyTasks;
