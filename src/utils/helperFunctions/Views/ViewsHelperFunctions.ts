import type { IFilterRuntimeContext } from "@/models/Filters/model";
import { pinProjectViewToUrl } from "@/lib/firstScreen/boardView";
import { IFilterSettings } from "@/models/Filters/model";
import { IProject, IProjectView, ISection, IUserProjectView, IView, IViewType } from "@/models/model";
import {
  DEFAULT_SUBTASK_SETTING,
  TBoardEmptySections,
  TBoardSortingLevel,
  TBoardSortingViewMode,
  TBoardSortingViewOrder,
  TBoardSubtaskSetting,
} from "@/models/Views/model";
import { deepCopy, getCurrentProject, getFromLocalStorage } from "@/utils/helperFunctions/helperFunctions";
import axios from "axios";
import { defaultFilterSettings, getFilteredSections } from "./FilterHelperFunctions";
import sortByStringParam from "@/utils/sortByParam";
import { TABLE_COLUMN_KEYS } from "./TableColumnsHelperFunctions";
import { SortingMode, SortingOrder } from "@prisma/client";
import { getAppliedSubtaskSections } from "./SubtaskHelperFunction";
import { getFilteredEmptySections } from "./EmptySectionsHelperFunction";
import { syncSectionAutoAssignFromCanonical } from "@/lib/sectionAutoAssign";


export const defaultBoardSortingSettings: TBoardSortingViewMode = "Manual"
export const defaultBoardSortingOrder: TBoardSortingViewOrder = "Descending"
export const MAX_SORT_LEVELS = 3

export const sanitizeSortingStack = (
  raw: unknown,
  level1Mode: TBoardSortingViewMode
): TBoardSortingLevel[] => {
  if (!Array.isArray(raw)) return []
  if (level1Mode === "Manual") return []

  const sortingModes = new Set<string>(Object.values(SortingMode))
  const sortingOrders = new Set<string>(Object.values(SortingOrder))
  const seenModes = new Set<TBoardSortingViewMode>([level1Mode])
  const sanitized: TBoardSortingLevel[] = []

  for (const value of raw) {
    if (!value || typeof value !== "object") continue
    const entry = value as Record<string, unknown>
    if (
      typeof entry.mode !== "string" ||
      typeof entry.order !== "string" ||
      !sortingModes.has(entry.mode) ||
      !sortingOrders.has(entry.order)
    ) continue

    const mode = entry.mode as TBoardSortingViewMode
    if (mode === "Manual" || seenModes.has(mode)) continue

    seenModes.add(mode)
    sanitized.push({
      mode,
      order: entry.order as TBoardSortingViewOrder,
    })
    if (sanitized.length === MAX_SORT_LEVELS - 1) break
  }

  return sanitized
}

export const buildViewId = (projectId: number, mode: "Filters" | "SortingMode" | "ColumnsView") => {
    switch (mode) {
        case "Filters":
            return `filters/projectId=${projectId}`
        case "SortingMode":
            return `board_view/sortingMode/projectId=${projectId}`
        case "ColumnsView":
            return `board_view/columns_view/projectId=${projectId}`;
        default:
            return `filters/projectId=${projectId}`
    }

};

export const buildDefaultTitle = (projectId:number)=> `default-view-id-${projectId}`

const reshapeSingleSection = (x:ISection)=>{
    return { 
        id: x.id!, 
        ranking: x.ranking!, 
        visibility: x.visibility!, 
        section_title: x.section_title!,
        isDone: x.isDone,
        projectId:x.projectId,
        deleted:x.deleted, 
    }
}

function syncColumnsWithProject(
    columnsViewLocalStorage: any[]=[],
    projectSections: ISection[]=[]
  ): { synced: ISection[], syncRequired: boolean } {
    let syncRequired = false;
  
    const sectionIds = new Set(projectSections.map((section) => section.id));
  
    projectSections.forEach((section) => {
      if (!columnsViewLocalStorage.some((col) => col.id === section.id)) {
        columnsViewLocalStorage.push(reshapeSingleSection(section));
        syncRequired = true;
      }
    });
  
    const filteredColumns = columnsViewLocalStorage.filter((col) => {
      const exists = sectionIds.has(col.id);
      if (!exists) {
        syncRequired = true;
      }
      return exists;
    });
    const sortedSync = sortByStringParam(filteredColumns, 'ranking')

    return {
      synced: sortedSync,
      syncRequired,
    };
  }

export const getActiveColumnsViewFromProject = (
  project?: IProject | null
): ISection[] => {
  if (!project) return [];
  const view = project.project_view?.user_project_views?.[0];
  const defaultView = project.project_view?.default_view?.board_columns_view as ISection[];
  const unsaved = view?.unsavedView?.board_columns_view as ISection[];
  const applied = view?.appliedView?.board_columns_view as ISection[];
  const columnsView = unsaved ?? applied ?? defaultView ?? project.section ?? [];
  const sectionsById = new Map(
    (project.section ?? []).map((section) => [
      section.id ?? section.sectionId,
      section,
    ])
  );

  const rankingById = new Map(
    (project.section ?? []).map((section) => [
      section.id ?? section.sectionId,
      section.ranking,
    ])
  );
  const ordered = [...columnsView].sort((a, b) => {
    const rankA = rankingById.get(a.id ?? a.sectionId);
    const rankB = rankingById.get(b.id ?? b.sectionId);
    if (rankA === undefined && rankB === undefined) return 0;
    if (rankA === undefined) return 1;
    if (rankB === undefined) return -1;
    return String(rankA).localeCompare(String(rankB));
  });

  return ordered.map((column) => {
    const section = sectionsById.get(column.id ?? column.sectionId);
    return section
      ? {
          ...syncSectionAutoAssignFromCanonical(column, section),
          isDone: section.isDone,
          wipLimit: section.wipLimit,
        }
      : column;
  });
};


export const getActiveSortingModeFromProject =  (project?: IProject | null): TBoardSortingViewMode => {
    if (!project) return defaultBoardSortingSettings
    const view = project.project_view?.user_project_views[0]
    const unsaved = view?.unsavedView?.board_sorting_mode
    const applied = view?.appliedView?.board_sorting_mode
    const defaultView = project.project_view?.default_view?.board_sorting_mode
    return unsaved??applied??defaultView??"Manual"
}

export const getActiveStalenessOverrideFromProject = (project?:IProject|null):boolean|null=>{
    const view = project?.project_view?.user_project_views?.[0]
    const unsaved = view?.unsavedView?.board_staleness
    const applied = view?.appliedView?.board_staleness
    const defaultView = project?.project_view?.default_view?.board_staleness
    return unsaved ?? applied ?? defaultView ?? null
}

export const getActiveStalenessFromProject = (project?:IProject|null):boolean=>{
    return getActiveStalenessOverrideFromProject(project) ?? !!project?.stalenessEnabled
}

export const getActiveShowArchivedOverrideFromProject = (project?:IProject|null):boolean|null=>{
    const view = project?.project_view?.user_project_views?.[0]
    const unsaved = view?.unsavedView?.board_show_archived
    const applied = view?.appliedView?.board_show_archived
    const defaultView = project?.project_view?.default_view?.board_show_archived
    return unsaved ?? applied ?? defaultView ?? null
}
export const resolveShowArchivedForBoard = (
    project: IProject | null | undefined,
    pending: { projectId: number; value: boolean } | null,
    browserPreference: boolean
): boolean => {
    if (pending && project && pending.projectId === project.id) return pending.value
    return getActiveShowArchivedOverrideFromProject(project) ?? browserPreference
}


export const getActiveFiltersFromProject = (project?:IProject|null, runtimeContext?:IFilterRuntimeContext):IFilterSettings=>{
    const view = project?.project_view?.user_project_views?.[0]
    if (!project || (!view && runtimeContext?.legacyMissingPersonalViewFilters)) return defaultFilterSettings
    const unsaved = view?.unsavedView?.board_filters as IFilterSettings
    const applied = view?.appliedView?.board_filters as IFilterSettings
    const defaultView = project.project_view?.default_view?.board_filters as IFilterSettings
    return deepCopy(unsaved??applied??defaultView??defaultFilterSettings)
}

export const getActiveSubtaskSettingFromProject = (project?:IProject|null):TBoardSubtaskSetting=>{
  const view = project?.project_view?.user_project_views[0]
  if (!project || !view) return DEFAULT_SUBTASK_SETTING
  const unsaved = view.unsavedView?.board_subtask_setting
  const applied = view.appliedView?.board_subtask_setting
  const defaultView = project.project_view?.default_view?.board_subtask_setting
  return deepCopy(unsaved??applied??defaultView??DEFAULT_SUBTASK_SETTING)
}

const personalEmptySectionSetting = (
  view?: IView,
): TBoardEmptySections | undefined => {
  const setting = view?.ViewLastUsed?.[0]?.board_empty_sections
  return setting === "Show" || setting === "Hidden" ? setting : undefined
}

const viewsWithId = (
  projectView: IProjectView | undefined,
  viewId: string,
): IView[] => {
  const row = projectView?.user_project_views[0]
  return [
    row?.appliedView,
    projectView?.default_view,
    ...(projectView?.allViews ?? []),
  ].filter((view): view is IView => view?.id === viewId)
}

export const getEmptySectionSettingForView = (
  projectView: IProjectView | undefined,
  viewId: string,
): TBoardEmptySections => {
  const views = viewsWithId(projectView, viewId)
  return deepCopy(
    views
      .map(personalEmptySectionSetting)
      .find((setting) => setting !== undefined) ??
      views[0]?.board_empty_sections ??
      "Show"
  )
}

export const getActiveEmptySectionSettingFromProjectView = (
  projectView?: IProjectView,
): TBoardEmptySections => {
  const row = projectView?.user_project_views[0]
  const baseView = row?.appliedView ?? projectView?.default_view
  const personal = baseView
    ? viewsWithId(projectView, baseView.id)
        .map(personalEmptySectionSetting)
        .find((setting) => setting !== undefined)
    : undefined
  const unsaved = row?.unsavedView?.board_empty_sections
  const applied = row?.appliedView?.board_empty_sections
  const defaultView = projectView?.default_view?.board_empty_sections
  return deepCopy(personal ?? unsaved ?? applied ?? defaultView ?? "Show")
}

export const getActiveEmptySectionSettingFromProject = (project?:IProject|null):TBoardEmptySections=>
  getActiveEmptySectionSettingFromProjectView(project?.project_view)

const patchPersonalEmptySectionSetting = (
  view: IView | undefined,
  viewId: string,
  setting: TBoardEmptySections,
): IView | undefined => {
  if (!view || view.id !== viewId) return view
  const existing = view.ViewLastUsed?.[0]
  return {
    ...view,
    ViewLastUsed: [
      { ...(existing ?? {}), board_empty_sections: setting },
      ...(view.ViewLastUsed?.slice(1) ?? []),
    ],
  } as IView
}

export const patchProjectViewEmptySections = (
  projectView: IProjectView,
  setting: TBoardEmptySections,
  viewId?: string,
): IProjectView => {
  if (viewId) {
    return {
      ...projectView,
      allViews: projectView.allViews?.map((view) =>
        patchPersonalEmptySectionSetting(view, viewId, setting)!
      ),
      default_view: patchPersonalEmptySectionSetting(
        projectView.default_view,
        viewId,
        setting,
      ),
      user_project_views: projectView.user_project_views.map((row) => ({
        ...row,
        appliedView: patchPersonalEmptySectionSetting(
          row.appliedView,
          viewId,
          setting,
        ),
      })),
    }
  }

  const activeRow = projectView.user_project_views[0]
  if (activeRow?.unsavedView) {
    return {
      ...projectView,
      user_project_views: projectView.user_project_views.map((row, index) =>
        index === 0
          ? { ...row, unsavedView: { ...row.unsavedView!, board_empty_sections: setting } }
          : row
      ),
    }
  }
  if (activeRow?.appliedView) {
    return {
      ...projectView,
      user_project_views: projectView.user_project_views.map((row, index) =>
        index === 0
          ? { ...row, appliedView: { ...row.appliedView!, board_empty_sections: setting } }
          : row
      ),
    }
  }
  return projectView.default_view
    ? {
        ...projectView,
        default_view: { ...projectView.default_view, board_empty_sections: setting },
      }
    : projectView
}

export type TPendingEmptySectionMutation = {
  id: number
  setting: TBoardEmptySections
  viewId?: string
}

export type TEmptySectionMutationState = {
  baseline: TBoardEmptySections
  viewId?: string
  pending: TPendingEmptySectionMutation[]
}

const emptySectionMutationSetting = (
  projectView: IProjectView,
  viewId?: string,
) => viewId
  ? getEmptySectionSettingForView(projectView, viewId)
  : getActiveEmptySectionSettingFromProjectView(projectView)

export const beginEmptySectionMutation = (
  state: TEmptySectionMutationState | undefined,
  projectView: IProjectView,
  mutation: TPendingEmptySectionMutation,
): { state: TEmptySectionMutationState; projectView: IProjectView } => {
  if (state && state.viewId !== mutation.viewId) {
    throw new Error("Empty-section mutation state belongs to another view")
  }
  return {
    state: {
      baseline: state?.baseline ?? emptySectionMutationSetting(projectView, mutation.viewId),
      viewId: mutation.viewId,
      pending: [...(state?.pending ?? []), mutation],
    },
    projectView: patchProjectViewEmptySections(
      projectView,
      mutation.setting,
      mutation.viewId,
    ),
  }
}

export const settleEmptySectionMutation = (
  state: TEmptySectionMutationState,
  mutationId: number,
  succeeded: boolean,
  authoritativeView: IProjectView,
): { state?: TEmptySectionMutationState; projectView: IProjectView } => {
  const pending = state.pending.filter((mutation) => mutation.id !== mutationId)
  const baseline = succeeded
    ? emptySectionMutationSetting(authoritativeView, state.viewId)
    : state.baseline
  const latest = pending[pending.length - 1]

  if (latest) {
    return {
      state: { baseline, viewId: state.viewId, pending },
      projectView: patchProjectViewEmptySections(
        authoritativeView,
        latest.setting,
        state.viewId,
      ),
    }
  }

  return {
    projectView: succeeded
      ? authoritativeView
      : patchProjectViewEmptySections(
          authoritativeView,
          baseline,
          state.viewId,
        ),
  }
}

export const getActiveSortingOrderFromProject =  (project?: IProject | null): TBoardSortingViewOrder => {
  if (!project) return defaultBoardSortingOrder
  const view = project.project_view?.user_project_views[0]
  const unsaved = view?.unsavedView?.board_sorting_order
  const applied = view?.appliedView?.board_sorting_order
  const defaultView = project.project_view?.default_view?.board_sorting_order
  return unsaved??applied??defaultView??'Descending'
}

export const getActiveSortingStackFromProject = (project?: IProject | null): TBoardSortingLevel[] => {
  if (!project) return []
  const view = project.project_view?.user_project_views[0]
  const activeView = view?.unsavedView ?? view?.appliedView ?? project.project_view?.default_view
  return sanitizeSortingStack(
    activeView?.board_sorting_stack ?? [],
    getActiveSortingModeFromProject(project)
  )
}

export type TTableSort = { column: string; direction: string } | null;

export type TSavedBoardLayout = "Board" | "Table";
export type TClientBoardLayout = "board" | "table";

export const sanitizeBoardLayout = (layout: unknown): TSavedBoardLayout | null =>
    layout === "Board" || layout === "Table" ? layout : null;

export const savedBoardLayoutToClient = (
    layout: unknown,
): TClientBoardLayout | null => {
    const sanitized = sanitizeBoardLayout(layout);
    return sanitized ? sanitized.toLowerCase() as TClientBoardLayout : null;
};

export const savedBoardLayoutFromExplicitSurface = (
    surface: unknown,
): TSavedBoardLayout | null => surface === "board"
    ? "Board"
    : surface === "table"
        ? "Table"
        : null;

export const clientBoardLayoutToSaved = (
    layout: TClientBoardLayout,
): TSavedBoardLayout => layout === "table" ? "Table" : "Board";

export const getBoardLayoutRequestUpdate = (
    source: unknown,
): Partial<{ board_layout: TSavedBoardLayout | null }> => {
    if (
        !source ||
        typeof source !== "object" ||
        !Object.prototype.hasOwnProperty.call(source, "board_layout")
    ) return {};
    return {
        board_layout: sanitizeBoardLayout(
            (source as { board_layout?: unknown }).board_layout,
        ),
    };
};

export const resolveShowArchivedRequest = (
    source: unknown,
    inherited: boolean | null,
): boolean | null => {
    if (!source || typeof source !== "object") return inherited
    if (!Object.prototype.hasOwnProperty.call(source, "board_show_archived")) return inherited
    const value = (source as Record<string, unknown>).board_show_archived
    return typeof value === "boolean" ? value : null
}

export const resolveBoardLayoutRequest = (
    source: unknown,
    inheritedLayout: unknown,
): TSavedBoardLayout | null => {
    const update = getBoardLayoutRequestUpdate(source);
    return Object.prototype.hasOwnProperty.call(update, "board_layout")
        ? update.board_layout ?? null
        : sanitizeBoardLayout(inheritedLayout);
};

export const getSavedBoardLayoutFromActiveView = ({
    unsavedView,
    appliedView,
    defaultView,
}: {
    unsavedView?: { board_layout?: unknown } | null;
    appliedView?: { board_layout?: unknown } | null;
    defaultView?: { board_layout?: unknown } | null;
}): TSavedBoardLayout | null => {
    const activeView = unsavedView ?? appliedView ?? defaultView;
    return sanitizeBoardLayout(activeView?.board_layout);
};

export const patchProjectViewBoardLayout = (
    projectView: IProjectView,
    viewId: string,
    boardLayout: TSavedBoardLayout | null,
): IProjectView => {
    const patchView = <T extends { id: string; board_layout?: TSavedBoardLayout | null }>(
        view: T | undefined,
    ): T | undefined => view?.id === viewId
        ? { ...view, board_layout: boardLayout }
        : view;

    return {
        ...projectView,
        allViews: projectView.allViews?.map((view) => patchView(view)!),
        default_view: patchView(projectView.default_view),
        user_project_views: projectView.user_project_views.map((row) => ({
            ...row,
            appliedView: patchView(row.appliedView),
        })),
    };
};

export const resolveBoardLayoutFromSurface = (
    surface: unknown,
    savedLayout: unknown,
    browserPreference: TClientBoardLayout,
): TClientBoardLayout => {
    if (surface === "board" || surface === "table") return surface;
    return savedBoardLayoutToClient(savedLayout) ?? browserPreference;
};

export const buildProjectSurfaceUrl = ({
    projectId,
    viewSlug,
    surface,
}: {
    projectId?: number;
    viewSlug?: string;
    surface?: TClientBoardLayout;
}): string => {
    const params = new URLSearchParams();
    if (projectId) params.set("id", String(projectId));
    if (viewSlug) params.set("view", viewSlug);
    if (surface) params.set("surface", surface);
    const query = params.toString();
    return query ? `/project?${query}` : "/project";
};

export const replaceProjectSurface = ({
    currentHref,
    surface,
    replace,
}: {
    currentHref: string;
    surface: TClientBoardLayout | null;
    replace: (destination: string, options: { scroll: false }) => void;
}): boolean => {
    const url = new URL(currentHref);
    if (!url.pathname.startsWith("/project")) return false;
    const current = `${url.pathname}${url.search}${url.hash}`;

    if (surface) url.searchParams.set("surface", surface);
    else url.searchParams.delete("surface");

    const destination = `${url.pathname}${url.search}${url.hash}`;
    if (destination === current) return false;

    replace(destination, { scroll: false });
    return true;
};

const boardViewMutationQueues = new Map<number, Promise<unknown>>();

export const enqueueBoardViewMutation = <T>(
    projectId: number,
    mutation: () => Promise<T>,
): Promise<T> => {
    const previous = boardViewMutationQueues.get(projectId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(mutation);
    boardViewMutationQueues.set(projectId, current);
    void current.finally(() => {
        if (boardViewMutationQueues.get(projectId) === current) {
            boardViewMutationQueues.delete(projectId);
        }
    }).catch(() => undefined);
    return current;
};

export const waitForBoardViewMutations = async (
    projectId: number,
): Promise<void> => {
    await boardViewMutationQueues.get(projectId);
};

export const getActiveBoardLayoutPreferenceFromProject = (
    project?: IProject | null,
): TSavedBoardLayout | null => {
    const row = project?.project_view?.user_project_views?.[0];
    const activeView = row?.unsavedView ?? row?.appliedView ?? project?.project_view?.default_view;
    return sanitizeBoardLayout(activeView?.board_layout);
};

export const getActiveTableSortFromProject = (project?: IProject | null): TTableSort => {
    const view = project?.project_view?.user_project_views?.[0]
    const activeView = view?.unsavedView ?? view?.appliedView ?? project?.project_view?.default_view
    if (activeView) {
        const column = activeView.table_sort_column ?? null
        const direction = activeView.table_sort_direction ?? null
        return column && direction ? { column, direction } : null
    }
    const column = view?.unsavedView?.table_sort_column ?? view?.appliedView?.table_sort_column ?? project?.project_view?.default_view?.table_sort_column ?? null
    const direction = view?.unsavedView?.table_sort_direction ?? view?.appliedView?.table_sort_direction ?? project?.project_view?.default_view?.table_sort_direction ?? null
    return column && direction ? { column, direction } : null
}

const STATIC_TABLE_SORT_COLUMN_KEYS = new Set<string>(TABLE_COLUMN_KEYS)
const TABLE_SORT_COLUMN_KEYS = {
    has: (column: string) => STATIC_TABLE_SORT_COLUMN_KEYS.has(column) || /^customField:[0-9a-f-]{36}$/i.test(column),
}
const TABLE_SORT_DIRECTIONS = new Set(["asc", "desc"])

export const sanitizeTableSort = (column: unknown, direction: unknown): { column: string | null; direction: string | null } => ({
    column: typeof column === "string" && TABLE_SORT_COLUMN_KEYS.has(column) ? column : null,
    direction: typeof direction === "string" && TABLE_SORT_DIRECTIONS.has(direction) ? direction : null,
})

export { getViewFromProject } from "@/lib/firstScreen/boardView";

export const pinProjectToUrlView = (project: IProject, viewSlug?: string | null, runtimeContext?: IFilterRuntimeContext, restoreUrlViewSections = true) => {
  const pinnedProject = pinProjectViewToUrl(project, viewSlug)
  if (pinnedProject === project) return project

  if (restoreUrlViewSections && Array.isArray(pinnedProject.section) && Array.isArray(pinnedProject.tasks)) {
    const { _sections, firstTask } = getCurrentProject(pinnedProject) as { _sections: ISection[]; firstTask: IProject["firstTask"] }
    pinnedProject.sections = _sections
    pinnedProject.firstTask = firstTask
  }

  let filteredSections = getFilteredSections(pinnedProject.sections ?? [], pinnedProject, undefined, {}, runtimeContext)
  filteredSections = getAppliedSubtaskSections(filteredSections, pinnedProject)
  filteredSections = getFilteredEmptySections(filteredSections, pinnedProject)
  pinnedProject.filteredSections = filteredSections
  return pinnedProject
}

export const getBoardAndUserAppliedSortingView = (_currentProject: IProject) => {
    const defaultView = _currentProject.project_view?.default_view?.board_sorting_mode
    const userAppliedView = _currentProject.project_view?.user_project_views[0]?.appliedView?.board_sorting_mode
    return { userAppliedView, defaultView }


}
