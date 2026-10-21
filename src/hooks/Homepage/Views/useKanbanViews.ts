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
  isBoardEmptySectionSetting,
  PERSONAL_EMPTY_SECTIONS_UPDATE_MODE,
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
  patchProjectViewEmptySections,
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
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7097_DELETED_VIEW_LEAVES_TABS_FLAG } from "@/lib/flags/keys";
import { reconcileActiveBoardQuery } from "@/lib/boardSync/reconcileActiveBoardQuery";

let emptySectionMutationId = 0
const emptySectionMutations = new Map<string, TEmptySectionMutationState>()

const useKanbanViews = (project: IProject | null) => {
  const hasUserSelectedView =
    project?.project_view?.user_project_views[0]?.appliedView;
  const { getProjectIdxAndAllData, updateProjectView } =
    UpdateKanban();
  const queryClient = useQueryClient();
  const deletedViewLeavesTabs = useFlag(HTPR_7097_DELETED_VIEW_LEAVES_TABS_FLAG);
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
      replaceCurrentSurface(boardLayoutPreference);
      setBoardLayout(boardLayoutPreference);
      return;
    }

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
      board_sorting_stack: mode === "Manual" ? [] : stack,
    }),
    project,
  );
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
    const targetView =
      project.project_view?.user_project_views[0]?.appliedView ??
      project.project_view?.default_view
    const targetViewId = targetView?.id
    const mutationKey = `${project.id}:${targetViewId ?? "unsaved"}`
    const { allData, projectToUpdateIndex } = getProjectIdxAndAllData(project.id)
    const cachedProject = allData?.updatedProjects[projectToUpdateIndex]
    const projectView = cachedProject?.project_view ?? project.project_view
    if (projectView && projectToUpdateIndex !== -1) {
      const optimistic = beginEmptySectionMutation(
        emptySectionMutations.get(mutationKey),
        projectView,
        { id: mutationId, setting: emptySection, viewId: targetViewId },
      )
      emptySectionMutations.set(mutationKey, optimistic.state)
      updateProjectView(projectToUpdateIndex, optimistic.projectView)
    }

    const settleMutation = (
      succeeded: boolean,
      authoritativeSetting?: TBoardEmptySections,
    ) => {
      const state = emptySectionMutations.get(mutationKey)
      const latest = getProjectIdxAndAllData(project.id)
      const latestProject = latest.allData?.updatedProjects[latest.projectToUpdateIndex]
      if (state && latestProject?.project_view && latest.projectToUpdateIndex !== -1) {
        const authoritativeView = authoritativeSetting && targetViewId
          ? patchProjectViewEmptySections(
              latestProject.project_view,
              authoritativeSetting,
              targetViewId,
            )
          : latestProject.project_view
        const settled = settleEmptySectionMutation(
          state,
          mutationId,
          succeeded,
          authoritativeView,
        )
        if (settled.state) emptySectionMutations.set(mutationKey, settled.state)
        else emptySectionMutations.delete(mutationKey)
        updateProjectView(latest.projectToUpdateIndex, settled.projectView)
      } else {
        emptySectionMutations.delete(mutationKey)
      }
      if (!succeeded) toast.error("Empty column visibility could not be saved")
    }

    if (!targetViewId) {
      return apiHandler(
        (queuedProject) => buildUnsavedBody(queuedProject, {
          board_empty_sections: emptySection,
        }),
        project,
        settleMutation,
      )
    }

    return enqueueBoardViewMutation(project.id, async () => {
      try {
        const response = await axios.post(updateViewAPIRoute, {
          projectId: project.id,
          viewId: targetViewId,
          updateMode: PERSONAL_EMPTY_SECTIONS_UPDATE_MODE,
          view_settings: { board_empty_sections: emptySection },
        })
        const savedSetting = response.data?.board_empty_sections
        settleMutation(
          true,
          isBoardEmptySectionSetting(savedSetting) ? savedSetting : emptySection,
        )
      } catch (error) {
        console.log("🚀 ~ saveEmptySectionsAPI ~ error:", error)
        settleMutation(false)
      }
    })
  };

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

  const saveShowArchivedAPI = async (
    project: IProject,
    showArchived: boolean
  ) => apiHandler(
    (queuedProject) => buildUnsavedBody(queuedProject, {
      board_show_archived: showArchived,
    }),
    project,
  );

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

  const changeBoardLayout = (nextLayout: BoardLayout) => {
    setBoardLayoutPreference(nextLayout);
    if (boardLayout !== nextLayout) setBoardLayout(nextLayout);
    replaceCurrentSurface(nextLayout);
  };

  const toggleBoardLayout = () =>
    changeBoardLayout(boardLayout === "table" ? "board" : "table");

  const setBoardLayoutForNavigation = changeBoardLayout;

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
    if (deletedViewLeavesTabs) {
      void reconcileActiveBoardQuery(queryClient, projectId);
    } else {
      void queryClient.refetchQueries({ queryKey: ["projectsAll"] });
    }
    return updatedProjectView;
  };
  const saveAsDefaultHandler = async (body: TCreate_view_body) => {
    const response = await axios.post("/api/projects/views/create-view", body);
    console.log("🚀 ~ saveAsDefaultHandler ~ response:", response);
    const view: string | undefined = response.data.view;
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
