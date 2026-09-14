"use client";

import BackButton from "@/components/Buttons/BackButton";
import { SplitTitle } from "@/components/Common/TaskRowComponents/TaskListRow";
import PriorityLabelComponent from "@/components/Modals/TaskPriority/PriorityLabelComponent";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import TableView from "@/components/PageComponents/Kanban/TableView/TableView";
import useClickOutside from "@/hooks/MultiPages/useClickOutside";
import { useFlag } from "@/hooks/useFlag";
import {
  MY_TASKS_PRIORITY_FILTER_FLAG,
  MY_TASKS_SHORTCUTS_WIDTH_FLAG,
  MY_TASKS_VIEWS_FLAG,
  MY_TASKS_BULK_SELECTION_FLAG,
} from "@/lib/flags/keys";
import { MyTasksBulkSelectionProvider } from "@/lib/contexts/MyTasks/BulkSelectionContext";
import MyTasksBulkActionBar from "@/components/PageComponents/MyTasks/MyTasksBulkActionBar";
import { PriorityConstants, type IPrioritiesConstants } from "@/lib/constants/constants";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import {
  myTasksViewAPIRoute,
  myTasksViewsAPIRoute,
} from "@/lib/constants/APIRouteConstants";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useRecoilValue } from "@/lib/state";
import { filterMyTasksByPriority } from "@/lib/myTasksFiltering";
import {
  applyMyTasksView,
  sortMyTasksViewSections,
  type MyTasksTask,
} from "@/lib/myTasksFiltering";
import { getMyTasksSplitIndex } from "@/lib/myTasksGrouping";
import type {
  MyTasksBoardMetadata,
  MyTasksSavedView,
  MyTasksViewConfig,
} from "@/models/MyTasksView";
import {
  DEFAULT_MY_TASKS_VIEW_CONFIG,
  parseMyTasksViewConfig,
} from "@/models/MyTasksView";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import { ISection, IUser } from "@/models/model";
import type { TBoardSortingViewMode } from "@/models/Views/model";
import { appShellRailAtom, showCommandsAtom } from "@/store";
import styles from "@/styles/search.module.scss";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Filter } from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import MyTasksViewControls from "./MyTasksViewControls";
import MyTasksViewTabs from "./MyTasksViewTabs";

interface IProps {
  sections: ISection[];
  tabs: string[];
  boards: MyTasksBoardMetadata[];
  currentUser: IUser;
  initialViews: MyTasksSavedView[];
  initialViewId: number | null;
  viewsEnabled: boolean;
}

const MY_TASKS_SORTING_MODE = "DueDate" as TBoardSortingViewMode;

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : fallback;
};

const MyTasks = ({
  sections,
  tabs,
  boards = [],
  currentUser,
  initialViews = [],
  initialViewId = null,
  viewsEnabled = false,
}: IProps) => {
  const isMbl = useContext(MobileViewContext);
  const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
  const showCommands = useRecoilValue(showCommandsAtom);
  const router = useRouter();
  const searchParams = useSearchParams();
  const myTasksShortcutsWidthEnabled = useFlag(MY_TASKS_SHORTCUTS_WIDTH_FLAG);
  const boardParam = searchParams?.get("board") ?? null;
  const [activeSplit, setActiveSplit] = useState(() =>
    myTasksShortcutsWidthEnabled
      ? getMyTasksSplitIndex(sections, boardParam)
      : 0
  );

  const myTasksViewsEnabled = useFlag(MY_TASKS_VIEWS_FLAG);
  const viewsFeatureEnabled = viewsEnabled && myTasksViewsEnabled;
  const viewParam = searchParams?.get("view") ?? null;
  const initialView = initialViews.find((view) => view.id === initialViewId);
  const [views, setViews] = useState(initialViews);
  const [activeViewId, setActiveViewId] = useState<number | null>(initialViewId);
  const [viewConfig, setViewConfig] = useState<MyTasksViewConfig>(() =>
    parseMyTasksViewConfig(initialView?.config ?? DEFAULT_MY_TASKS_VIEW_CONFIG),
  );
  const [viewBusy, setViewBusy] = useState(false);
  const [dateFilterVersion, setDateFilterVersion] = useState(0);

  const filterEnabled = useFlag(MY_TASKS_PRIORITY_FILTER_FLAG);
  const myTasksBulkSelectionEnabled = useFlag(MY_TASKS_BULK_SELECTION_FLAG);
  // My Tasks spans every board, so unlike board filters (which persist to a
  // saved view) this selection lives in state only and resets on reload.
  const [prioritySelection, setPrioritySelection] = useState<
    IPrioritiesConstants[]
  >([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const saveRequestToken = useRef(0);
  const observedViewParam = useRef<string | null | undefined>(undefined);
  const updateViewConfig = useCallback(
    (next: MyTasksViewConfig | ((current: MyTasksViewConfig) => MyTasksViewConfig)) => {
      saveRequestToken.current += 1;
      setViewConfig(next);
    },
    [],
  );
  useClickOutside(filterRef, () => setFilterOpen(false));

  useEffect(() => {
    if (!viewsFeatureEnabled) return;
    const refreshDateFilters = () => setDateFilterVersion((version) => version + 1);
    window.addEventListener("focus", refreshDateFilters);
    return () => window.removeEventListener("focus", refreshDateFilters);
  }, [viewsFeatureEnabled]);

  const activeView = views.find((view) => view.id === activeViewId);
  const baselineConfig = parseMyTasksViewConfig(
    activeView?.config ?? DEFAULT_MY_TASKS_VIEW_CONFIG,
  );
  const dirty = JSON.stringify(viewConfig) !== JSON.stringify(baselineConfig);

  // One gate for both control and behavior: if the flag flips off while a
  // selection exists, filtering stops too instead of hiding the control.
  const selectedPriorities = filterEnabled ? prioritySelection : [];
  const priorityFilteredSections = useMemo(
    () => filterMyTasksByPriority(sections, selectedPriorities),
    [sections, selectedPriorities]
  );

  const viewFilteredSections = useMemo(() => {
    const now = new Date();
    const selectedBoards = viewConfig.boardIds
      ? new Set(viewConfig.boardIds)
      : null;
    const next = sections
      .filter(
        (section) =>
          !selectedBoards ||
          (section.projectId !== undefined && selectedBoards.has(section.projectId)),
      )
      .map((section) => ({
        ...section,
        items: applyMyTasksView(
          section.items as MyTasksTask[],
          viewConfig,
          now,
        ),
      }));
    return sortMyTasksViewSections(next, viewConfig, now);
  }, [dateFilterVersion, sections, viewConfig]);
  const filteredSections = viewsFeatureEnabled
    ? viewFilteredSections
    : priorityFilteredSections;

  const activeTabs = useMemo(
    () =>
      viewsFeatureEnabled
        ? ["All", ...filteredSections.map((section) => section.section_title)]
        : tabs,
    [filteredSections, tabs, viewsFeatureEnabled],
  );
  const activeBoardId = useRef<number | null>(
    filteredSections[activeSplit - 1]?.projectId ?? null,
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
      if (!viewsFeatureEnabled) {
        updateLegacySplit(index);
        return;
      }
      const nextIndex = Math.max(0, Math.min(index, activeTabs.length - 1));
      activeBoardId.current = filteredSections[nextIndex - 1]?.projectId ?? null;
      setActiveSplit(nextIndex);
      if (myTasksShortcutsWidthEnabled) {
        replaceBoardParam(filteredSections[nextIndex - 1]?.projectId ?? null);
      }
    },
    [
      activeTabs.length,
      filteredSections,
      myTasksShortcutsWidthEnabled,
      replaceBoardParam,
      updateLegacySplit,
      viewsFeatureEnabled,
    ],
  );

  useEffect(() => {
    if (!myTasksShortcutsWidthEnabled) return;
    setActiveSplit(getMyTasksSplitIndex(sections, boardParam));
  }, [boardParam, myTasksShortcutsWidthEnabled, sections]);

  useEffect(() => {
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
    boardParam,
    filteredSections,
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
  }, [activeSplit, activeTabs.length, filterOpen, router, showCommands.show, updateSplit]);

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

  const saveView = async () => {
    if (!activeView) return;
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

  const tabLength = (index: number) =>
    index === 0 ? totalCount : filteredSections[index - 1]?.items.length ?? 0;

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
      }}
    />
  ));

  const content = (
    <div
      suppressHydrationWarning
      className={`py-9 h-screen min-h-0 overflow-hidden bg-containerBackground flex-col rounded-[4px] my-0 ${myTasksShortcutsWidthEnabled ? "w-full" : "global-view-width"} flex linksModal ${styles.links_modal}`}
    >
      {viewsEnabled && myTasksViewsEnabled && (
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
          />
        </div>
      )}

      <div className="flex gap-2 px-[16px] @md:!px-[88px]">
        <span className="flex items-baseline gap-2 font-bold text-subheading text-white-black">
          <p>My Tasks</p>
          <span className="text-content font-normal text-text-light-gray">
            {totalCount}
          </span>
        </span>
        {viewsEnabled && myTasksViewsEnabled && (
          <MyTasksViewControls
            boards={boards}
            config={viewConfig}
            onChange={updateViewConfig}
          />
        )}
        {filterEnabled && (
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

      <div className="hidden @md:block w-full overflow-x-auto scrollbar-none no-scrollbar @md:px-[78px] @lg:px-[73px] mt-4">
        <div className="flex flex-wrap grow">{splitTitles}</div>
      </div>

      <div className="mt-3 flex-1 min-h-0 w-full">
        {myTasksBulkSelectionEnabled ? (
          <MyTasksBulkSelectionProvider
            resetSelectionKey={`${activeViewId ?? "all"}:${activeSplit}:${prioritySelection
              .map((priority) => priority.priority_index)
              .join(",")}`}
            onAfterMutation={() => router.refresh()}
          >
            <TableView
              filteredSections={visibleSections}
              _sections={visibleSections}
              _currentProject={null}
              _activeSortingMode={MY_TASKS_SORTING_MODE}
              currentUser={currentUser}
              myTasksSort={viewsFeatureEnabled ? viewConfig.sort : undefined}
              myTasksSortKey={activeViewId}
              onMyTasksSortChange={viewsFeatureEnabled ? updateViewSort : undefined}
              enableMyTasksBulkSelection
            />
            <MyTasksBulkActionBar />
          </MyTasksBulkSelectionProvider>
        ) : (
          <TableView
            filteredSections={visibleSections}
            _sections={visibleSections}
            _currentProject={null}
            _activeSortingMode={MY_TASKS_SORTING_MODE}
            currentUser={currentUser}
            myTasksSort={viewsFeatureEnabled ? viewConfig.sort : undefined}
            myTasksSortKey={activeViewId}
            onMyTasksSortChange={viewsFeatureEnabled ? updateViewSort : undefined}
          />
        )}
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
    </>
  );
};

export default MyTasks;
