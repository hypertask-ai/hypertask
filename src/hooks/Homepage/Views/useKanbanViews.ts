import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import {
  deleteRenameViewAPIRoute,
  resetToDefaultAPIRoute,
  switchViewAPIRoute,
  unsavedViewAPIRoute,
  updateViewAPIRoute,
} from "@/lib/constants/APIRouteConstants";
import { IFilterSettings } from "@/models/Filters/model";
import {
  IProject,
  IProjectView,
  ISection,
  IViewAPI,
} from "@/models/model";
import {
  TBoardEmptySections,
  TBoardSortingLevel,
  TBoardSortingViewMode,
  TBoardSortingViewOrder,
  TBoardSubtaskSetting,
  TBodyAPIUnsaved,
  TCreate_view_body,
  TUpdate_view_body,
} from "@/models/Views/model";
import { deepCopy } from "@/utils/helperFunctions/helperFunctions";
import {
  beginEmptySectionMutation,
  getActiveColumnsViewFromProject,
  getActiveBoardLayoutPreferenceFromProject,
  getActiveEmptySectionSettingFromProject,
  getActiveFiltersFromProject,
  getActiveStalenessOverrideFromProject,
  getActiveShowArchivedOverrideFromProject,
  getActiveSortingModeFromProject,
  getActiveSortingOrderFromProject,
  getActiveSortingStackFromProject,
  getActiveSubtaskSettingFromProject,
  getActiveTableSortFromProject,
  getViewFromProject,
  enqueueBoardViewMutation,
  patchProjectViewBoardLayout,
  replaceProjectSurface,
  savedBoardLayoutFromExplicitSurface,
  savedBoardLayoutToClient,
  settleEmptySectionMutation,
  type TEmptySectionMutationState,
  TTableSort,
} from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { isProjectViewResponseForBoard } from "@/utils/helperFunctions/Views/ProjectViewState";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import toast from "react-hot-toast";
import nookies from "nookies";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { activeBuiltinViewsAtom, boardLayoutAtom, boardLayoutPreferenceAtom, type BoardLayout } from "@/store";
import {
  BoardView,
  isBuiltinView,
} from "@/lib/constants/builtinViews";
import { useRouter } from "next/navigation";

let emptySectionMutationId = 0
// Keep rapid toggles layered so one request settling cannot remove a newer choice.
const emptySectionMutations = new Map<number, TEmptySectionMutationState>()

const useKanbanViews = (project: IProject | null) => {
  const hasUserSelectedView =
    project?.project_view?.user_project_views[0]?.appliedView;
  const { getProjectIdxAndAllData, updateProjectView } =
    UpdateKanban();
  const queryClient = useQueryClient();
  const router = useRouter();
  const setActiveBuiltinViews = useSetRecoilState(activeBuiltinViewsAtom);
  const activeBuiltinViews = useRecoilValue(activeBuiltinViewsAtom);
  const [boardLayout, setBoardLayout] = useRecoilState(boardLayoutAtom);
  const [boardLayoutPreference, setBoardLayoutPreference] = useRecoilState(boardLayoutPreferenceAtom);

  const replaceCurrentSurface = (surface: BoardLayout | null) => {
    if (typeof window === "undefined") return;
    replaceProjectSurface({
      currentHref: window.location.href,
      surface,
      replace: (destination, options) => router.replace(destination, options),
    });
  };

  const boardLayoutForRequest = (baseProject: IProject) =>
    savedBoardLayoutFromExplicitSurface(
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("surface"),
    ) ??
    getActiveBoardLayoutPreferenceFromProject(baseProject);

  const applySavedBoardLayout = (view?: BoardView) => {
    if (!view || isBuiltinView(view)) return;
    setBoardLayout(savedBoardLayoutToClient(view.board_layout) ?? boardLayoutPreference);
  };

  const applyBoardLayoutPreference = (
    preference: "Board" | "Table" | null | undefined,
  ) => {
    replaceCurrentSurface(null);
    setBoardLayout(savedBoardLayoutToClient(preference) ?? boardLayoutPreference);
  };

  const cacheUpdateHandler = (response: any, updateType: IViewAPI) => {
    if (!project) return;
    const { allData, projectToUpdateIndex } = getProjectIdxAndAllData(
      project.id
    );
    const projectToUpdate = deepCopy(
      allData?.updatedProjects[projectToUpdateIndex]
    );
    if (!projectToUpdate) return;
    if (
      updateType.call === "switch" ||
      updateType.call === "reset" ||
      updateType.call === "rename"
    ) {
      const activeView = getViewFromProject(project);
      if (updateType.call === "rename") {
        const appliedViewId =
          project.project_view?.user_project_views[0]?.appliedView?.id;
        if (updateType.view?.id === appliedViewId) {
          updateCookieAndURL(project.id, updateType.view?.slug);
        }
        return updateProjectView(projectToUpdateIndex, response.data);
      }
      if (updateType.call === "reset" && activeView?.type === "Unsaved") {
        const appliedView =
          project.project_view?.user_project_views[0].appliedView;
        if (appliedView) updateCookieAndURL(project.id, appliedView.slug);
        return updateProjectView(projectToUpdateIndex, response.data);
      }
      updateCookieAndURL(
        project.id,
        updateType.view?.id === project.project_view?.default_view_id
          ? undefined
          : updateType.view?.slug
      );
    }
    updateProjectView(projectToUpdateIndex, response.data);
  };

  const apiAndCacheHandler = async (
    apiURL: string,
    body: any,
    updateType: IViewAPI
  ) => {
    const response = await axios.post(apiURL, body);
    if (response.status !== 200) return;
    cacheUpdateHandler(response, updateType);
  };

  const switchViewHandler = async (view: BoardView) => {
    if (!project) return;
    if (isBuiltinView(view)) {
      setActiveBuiltinViews((current: Record<number, string>) => ({
        ...current,
        [project.id]: view.id,
      }));
      // Built-ins do not carry saved-view settings. Restore the browser's
      // persisted preference without creating an unsaved view, and keep the
      // explicit URL surface aligned so later snapshots cannot read stale intent.
      replaceCurrentSurface(boardLayoutPreference);
      setBoardLayout(boardLayoutPreference);
      return;
    }

    // Leave the built-in BEFORE the switch call. The cache rebuild inside
    // apiAndCacheHandler re-filters the board with whatever built-in is active,
    // so clearing afterwards baked the built-in's filter into the saved view:
    // the pill moved but the board kept showing e.g. only Blocked tasks.
    setActiveBuiltinViews((current: Record<number, string>) => {
      if (!(project.id in current)) return current;
      const next = { ...current };
      delete next[project.id];
      return next;
    });

    const body = {
      projectId: project.id,
      newViewId: view.id,
    };
    await enqueueBoardViewMutation(project.id, () =>
      apiAndCacheHandler(switchViewAPIRoute, body, {
        call: "switch",
        view,
      }),
    );
    applySavedBoardLayout(view);
  };

  const apiHandler = async (
    body:
      | TBodyAPIUnsaved
      | ((queuedProject: IProject) => TBodyAPIUnsaved),
    baseProject: IProject,
    onSettled?: (succeeded: boolean) => void,
  ): Promise<void> =>
    enqueueBoardViewMutation(baseProject.id, async () => {
      try {
        const { allData, projectToUpdateIndex } = getProjectIdxAndAllData(
          baseProject.id,
        );
        const queuedProject = deepCopy(
          allData?.updatedProjects[projectToUpdateIndex],
        ) ?? baseProject;
        const requestBody = typeof body === "function" ? body(queuedProject) : body;
        const activeView = getViewFromProject(queuedProject)
        const baseViewId = activeView?.type === "Default"
          ? null
          : queuedProject.project_view?.user_project_views[0]?.appliedView?.id ?? null
        await apiAndCacheHandler(unsavedViewAPIRoute, { ...requestBody, baseViewId }, { call: "unsaved" });
      } catch (error) {
        onSettled?.(false)
        console.log("🚀 ~ apiHandler ~ error:", error);
        return;
      }
      onSettled?.(true)
    });

  const buildUnsavedBody = (
    queuedProject: IProject,
    overrides: Partial<TBodyAPIUnsaved> = {},
  ): TBodyAPIUnsaved => ({
    projectId: queuedProject.id,
    board_columns_view: getActiveColumnsViewFromProject(queuedProject),
    board_sorting_mode: getActiveSortingModeFromProject(queuedProject),
    board_sorting_order: getActiveSortingOrderFromProject(queuedProject),
    board_sorting_stack: getActiveSortingStackFromProject(queuedProject),
    board_filters: getActiveFiltersFromProject(queuedProject),
    board_subtask_setting: getActiveSubtaskSettingFromProject(queuedProject),
    board_empty_sections: getActiveEmptySectionSettingFromProject(queuedProject),
    board_staleness: getActiveStalenessOverrideFromProject(queuedProject),
    board_show_archived: getActiveShowArchivedOverrideFromProject(queuedProject),
    table_sort_column: getActiveTableSortFromProject(queuedProject)?.column ?? null,
    table_sort_direction: getActiveTableSortFromProject(queuedProject)?.direction ?? null,
    board_layout: boardLayoutForRequest(queuedProject),
    ...overrides,
  });

  const setBoardSortingViewAndReturn = async (
    project: IProject,
    mode: TBoardSortingViewMode,
    order: TBoardSortingViewOrder,
    stack: TBoardSortingLevel[] = []
  ) => apiHandler(
    (queuedProject) => buildUnsavedBody(queuedProject, {
      board_sorting_mode: mode,
      board_sorting_order: order,
      // Manual has nothing to tie-break, so never leave a stack stored behind it: it would stay
      // dormant and then resurface the next time a primary sort is picked.
      board_sorting_stack: mode === "Manual" ? [] : stack,
    }),
    project,
  );
  // ======= set a new value and return it
  const setBoardColumnsViewAPI = async (
    project: IProject,
    columnsToUpdate: ISection[]
  ) => apiHandler(
    (queuedProject) => buildUnsavedBody(queuedProject, {
      board_columns_view: columnsToUpdate,
    }),
    project,
  );

  const saveFilterAPI = async (
    project: IProject,
    filterForThisProject: IFilterSettings,
    columnsOverride?: ISection[]
  ) => apiHandler(
    (queuedProject) => buildUnsavedBody(queuedProject, {
      ...(columnsOverride ? { board_columns_view: columnsOverride } : {}),
      board_filters: filterForThisProject,
    }),
    project,
  );

  const saveEmptySectionsAPI = async (
    project: IProject,
    emptySection: TBoardEmptySections
  ) => {
    const mutationId = ++emptySectionMutationId
    const { allData, projectToUpdateIndex } = getProjectIdxAndAllData(project.id)
    const cachedProject = allData?.updatedProjects[projectToUpdateIndex]
    const projectView = cachedProject?.project_view ?? project.project_view
    if (projectView && projectToUpdateIndex !== -1) {
      const optimistic = beginEmptySectionMutation(
        emptySectionMutations.get(project.id),
        projectView,
        { id: mutationId, setting: emptySection },
      )
      emptySectionMutations.set(project.id, optimistic.state)
      updateProjectView(projectToUpdateIndex, optimistic.projectView)
    }

    return apiHandler(
      (queuedProject) => buildUnsavedBody(queuedProject, {
        board_empty_sections: emptySection,
      }),
      project,
      (succeeded) => {
        const state = emptySectionMutations.get(project.id)
        const latest = getProjectIdxAndAllData(project.id)
        const latestProject = latest.allData?.updatedProjects[latest.projectToUpdateIndex]
        if (state && latestProject?.project_view && latest.projectToUpdateIndex !== -1) {
          const settled = settleEmptySectionMutation(
            state,
            mutationId,
            succeeded,
            latestProject.project_view,
          )
          if (settled.state) emptySectionMutations.set(project.id, settled.state)
          else emptySectionMutations.delete(project.id)
          updateProjectView(latest.projectToUpdateIndex, settled.projectView)
        } else {
          emptySectionMutations.delete(project.id)
        }
        if (!succeeded) toast.error("Empty column visibility could not be saved")
      },
    )
  };

  // Persist the per-view staleness override into the ACTIVE SAVED view (applied,
  // else the board's default view), so it survives navigation. Writing the
  // unsaved view instead is pointless here: switch-view deletes it on the next
  // view change. Returns "none" when the board has no saved view to attach it
  // to; the caller then falls back to the board-level setting.
  const saveStalenessToViewAPI = async (
    project: IProject,
    stalenessOverride: boolean | null
  ): Promise<"view" | "none"> =>
    enqueueBoardViewMutation(project.id, async () => {
      const { allData, projectToUpdateIndex } = getProjectIdxAndAllData(project.id);
      const queuedProject = deepCopy(
        allData?.updatedProjects[projectToUpdateIndex],
      ) ?? project;
      const pv = queuedProject.project_view;
      const targetViewId =
        pv?.user_project_views?.[0]?.appliedView?.id ?? pv?.default_view?.id;
      if (!targetViewId) return "none";
      const { projectId, ...viewSettings } = buildUnsavedBody(queuedProject, {
        board_staleness: stalenessOverride,
      });
      const body: TUpdate_view_body = {
        projectId,
        viewId: targetViewId,
        view_settings: viewSettings,
      };
      await apiAndCacheHandler(updateViewAPIRoute, body, { call: "update" });
      return "view";
    });

  // "Show archived tasks" is a view setting like filters and sorting, so it
  // goes through the unsaved view: the board updates immediately and the Save
  // View affordance appears, letting the choice be pinned to the view instead
  // of lasting only until navigation (HTPR-5540).
  const saveShowArchivedAPI = async (
    project: IProject,
    showArchived: boolean
  ) => apiHandler(
    (queuedProject) => buildUnsavedBody(queuedProject, {
      board_show_archived: showArchived,
    }),
    project,
  );

  // Table-view sort. Same shape as setBoardSortingViewAndReturn (kanban's board
  // sort), except this is table-only state so it goes through the unsaved-view
  // API carrying every other current setting to avoid isDeepEqual thrashing them.
  const setTableSortViewAndReturn = async (
    project: IProject,
    tableSort: TTableSort
  ) => apiHandler(
    (queuedProject) => buildUnsavedBody(queuedProject, {
      table_sort_column: tableSort?.column ?? null,
      table_sort_direction: tableSort?.direction ?? null,
    }),
    project,
  );

  const saveSubtaskSettingAPI = async (
    project: IProject,
    subTaskSetting: TBoardSubtaskSetting
  ) => apiHandler(
    (queuedProject) => buildUnsavedBody(queuedProject, {
      board_subtask_setting: subTaskSetting,
    }),
    project,
  );

  // Board/Table controls are surface navigation, not saved-view editing.
  // Persist the browser preference and explicit URL intent, but leave the
  // active view untouched. A saved view's opening layout is configured in
  // Manage Views, alongside its other durable metadata.
  const changeBoardLayout = (nextLayout: BoardLayout) => {
    setBoardLayoutPreference(nextLayout);
    if (boardLayout !== nextLayout) setBoardLayout(nextLayout);
    replaceCurrentSurface(nextLayout);
  };

  const toggleBoardLayout = () =>
    changeBoardLayout(boardLayout === "table" ? "board" : "table");

  const setBoardLayoutForNavigation = changeBoardLayout;

  // ============ reset view
  const resetView = async (mode: "ResetCurrent" | "ResetToDefault") => {
    if (!project) return;
    const body = {
      projectId: project.id,
      mode,
    };
    await enqueueBoardViewMutation(project.id, () =>
      apiAndCacheHandler(resetToDefaultAPIRoute, body, { call: "reset" }),
    );
    const { allData, projectToUpdateIndex } = getProjectIdxAndAllData(project.id);
    const resetProject = allData?.updatedProjects[projectToUpdateIndex] ?? project;
    const row = resetProject.project_view?.user_project_views?.[0];
    const restored = mode === "ResetToDefault"
      ? resetProject.project_view?.default_view
      : row?.appliedView ?? resetProject.project_view?.default_view;
    applyBoardLayoutPreference(restored?.board_layout);
  };

  // ============ update view
  const updateView = async (body: TUpdate_view_body) => {
    await apiAndCacheHandler(updateViewAPIRoute, body, { call: "update" });
    toast.success("View successfully updated!");
  };

  const updateViewLayout = async (
    projectId: number,
    viewId: string,
    boardLayout: "Board" | "Table" | null,
  ) => {
    await enqueueBoardViewMutation(projectId, async () => {
      await axios.post(
        updateViewAPIRoute,
        {
          projectId,
          viewId,
          updateMode: "layout",
          view_settings: { board_layout: boardLayout },
        },
      );
      const { allData, projectToUpdateIndex } = getProjectIdxAndAllData(projectId);
      const projectToUpdate = deepCopy(
        allData?.updatedProjects[projectToUpdateIndex],
      );
      if (projectToUpdate?.project_view) {
        updateProjectView(
          projectToUpdateIndex,
          patchProjectViewBoardLayout(
            projectToUpdate.project_view,
            viewId,
            boardLayout,
          ),
        );
      }
    });
    toast.success("View layout successfully updated!");
  };

  // ============ rename view
  const renameView = async (
    viewId: string,
    title: string,
    projectId: number
  ) => {
    const response = await axios.post(deleteRenameViewAPIRoute, {
      viewId,
      projectId,
      title,
    });
    if (response.status !== 200) return;
    console.log("🚀 ~ useKanbanViews ~ response:", response);
    const updatedView = response.data.view;
    response.data = { ...response.data.project_view_updated };
    cacheUpdateHandler(response, { call: "rename", view: updatedView });
  };

  // ============ delete view
  const deleteView = async (
    viewId: string,
    projectId: number,
  ): Promise<IProjectView> => {
    const deletingAppliedView =
      project?.project_view?.user_project_views[0]?.appliedView?.id === viewId;
    const response = await axios.delete(
      deleteRenameViewAPIRoute + `?viewId=${viewId}&projectId=${projectId}`
    );
    if (response.status !== 200) throw new Error("View deletion failed");
    const updatedProjectView: unknown = response.data;
    if (!isProjectViewResponseForBoard(updatedProjectView, projectId)) {
      throw new Error("View deletion returned invalid project data");
    }

    if (deletingAppliedView) updateCookieAndURL(projectId);
    cacheUpdateHandler(response, { call: "update" });
    // The cache patch no-ops when projectsAll is not loaded on this page.
    void queryClient.refetchQueries({ queryKey: ["projectsAll"] });
    return updatedProjectView;
  };
  const saveAsDefaultHandler = async (body: TCreate_view_body) => {
    const response = await axios.post("/api/projects/views/create-view", body);
    console.log("🚀 ~ saveAsDefaultHandler ~ response:", response);
    const view: string | undefined = response.data.view;
    // Patch the saved/default view before changing the URL. Otherwise the
    // surface initializer can resolve the new slug against stale cache once,
    // then keep that wrong layout for the rest of the navigation key.
    if (response.data.project_view_updated) {
      cacheUpdateHandler(
        { data: response.data.project_view_updated },
        { call: "update" },
      );
    }
    updateCookieAndURL(body.projectId, view);
    applyBoardLayoutPreference(body.view_settings.board_layout);
    void queryClient.refetchQueries({ queryKey: ["projectsAll"] });
  };

  const renameColumnAPI = async (
    currentUserId: number,
    sectionToUpdateId: number | undefined,
    updatedSection: ISection
  ) => {
    console.log("🚀 ~ renameColumnAPI ~ called", currentUserId);
    const response = await axios.post(`/api/section/rename`, {
      userId: currentUserId,
      sectionId: sectionToUpdateId,
      newSection: updatedSection,
    });
    if (response.status !== 200) return;
    cacheUpdateHandler(response, { call: "update" });
  };

  const updateCookieAndURL = (projectId: number, view?: string) => {
    nookies.destroy(null, "previousBoard");
    nookies.set(null, "previousBoard", `project-${projectId}|&|${view}`, {
      maxAge: 600 * 60 * 24 * 7,
      path: "/",
    });
    queryClient.refetchQueries({ queryKey: ["projectsAllMinimal"] });
    if (view)
      window.history.pushState({}, "", `/project?id=${projectId}&view=${view}`);
    else window.history.pushState({}, "", `/project?id=${projectId}`);
  };

  return {
    saveEmptySectionsAPI,
    saveStalenessToViewAPI,
    saveShowArchivedAPI,
    hasUserSelectedView,
    setBoardSortingViewAndReturn,
    setTableSortViewAndReturn,
    saveFilterAPI,
    setBoardColumnsViewAPI,
    switchViewHandler,
    resetView,
    updateView,
    updateViewLayout,
    deleteView,
    renameView,
    saveAsDefaultHandler,
    saveSubtaskSettingAPI,
    changeBoardLayout,
    toggleBoardLayout,
    setBoardLayoutForNavigation,
    applyBoardLayoutPreference,
    renameColumnAPI,
  };
};

export default useKanbanViews;
