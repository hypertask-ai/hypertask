import { IFilterSettings } from "@/models/Filters/model";
import { IProject, IProjectView, ISection, IUserProjectView, IViewType } from "@/models/model";
import {
  DEFAULT_SUBTASK_SETTING,
  TBoardEmptySections,
  TBoardSortingLevel,
  TBoardSortingViewMode,
  TBoardSortingViewOrder,
  TBoardSubtaskSetting,
} from "@/models/Views/model";
import { deepCopy, getFromLocalStorage } from "@/utils/helperFunctions/helperFunctions";
import axios from "axios";
import { defaultFilterSettings, getFilteredSections } from "./FilterHelperFunctions";
import sortByStringParam from "@/utils/sortByParam";
import { TABLE_COLUMN_KEYS } from "./TableColumnsHelperFunctions";
import { SortingMode, SortingOrder } from "@prisma/client";
import { getAppliedSubtaskSections } from "./SubtaskHelperFunction";
import { getFilteredEmptySections } from "./EmptySectionsHelperFunction";
import { syncSectionAutoAssignFromCanonical } from "@/lib/sectionAutoAssign";

// now that i think, we could modularize a lot of this, bonus task

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

// Define default conditions for each filter type
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
// ======== SUPER IMPORTANT 
// THIS FUNCTION IS RESPONSIBLE FOR HOLDING TOGETHER THE VIEWS.
// So a user sends their project, but whatever is saved in the database is not what we really sort by.
// we prioritize the local storage.
// but in case local storage isn't present, then we see okay what the applied view is right now.
// if there is no applied view, then we check the BOARD's default view.
// IN A RARE MIRACLE case even if that doesn't exist, then we just go with default "Manual"
// ======== sets view settings for columns view

//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// ========================== COLUMN VIEW FUNCTIONS 

// ======= set a new value and return it
// export const setBoardColumnsViewAndReturn = (projectId: number, defaultSections?: any) => {
//     const localStorageId = buildViewId(projectId, "ColumnsView")
//     setInLocalStorage(localStorageId, defaultSections)
//     return getFromLocalStorage(localStorageId)

// }

// =================== get the column view for the given board
// export function getColumnViewForProject(projectId: number):TBoardColumnView[] {
//     const localStorageId = buildViewId(projectId, "ColumnsView")
//     return getFromLocalStorage(localStorageId)
// }

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
// just a mini-helper function to reshape the columns from board for column_views in localstorage
// export const reshapeBoardColumnsForViews = (sections: ISection[]) => {
//     return sections.map((x) => (reshapeSingleSection(x)))
// }

function syncColumnsWithProject(
    columnsViewLocalStorage: any[]=[], // Adjust type based on your data structure
    projectSections: ISection[]=[] // Adjust type based on your data structure
  ): { synced: ISection[], syncRequired: boolean } {
    let syncRequired = false;
  
    // Create a set of current section IDs
    const sectionIds = new Set(projectSections.map((section) => section.id));
  
    // Add any new sections to columnsViewLocalStorage
    projectSections.forEach((section) => {
      if (!columnsViewLocalStorage.some((col) => col.id === section.id)) {
        columnsViewLocalStorage.push(reshapeSingleSection(section));
        syncRequired = true; // Set flag if any new section was added
      }
    });
  
    // Filter out columns that no longer exist in projectSections
    const filteredColumns = columnsViewLocalStorage.filter((col) => {
      const exists = sectionIds.has(col.id);
      if (!exists) {
        syncRequired = true; // Set flag if any column was removed
      }
      return exists;
    });
    const sortedSync = sortByStringParam(filteredColumns, 'ranking')

    // Return the updated columns and sync status
    return {
      synced: sortedSync,
      syncRequired,
    };
  }
  
// export const syncChangesForColumns = (project:IProject):any[]|undefined=>{
//     let columnsViewLocalStorage = getColumnViewForProject(project.id)??[]
//     const { userAppliedView, defaultView } = getBoardAndUserAppliedColumnView(project)
//     const columnViewInDB = userAppliedView ?? defaultView ?? []

//     // lets check first if there are unsaved changes
//     const areColumnsDifferent = !!userAppliedView 
//     ? !isDeepEqual(columnsViewLocalStorage, userAppliedView) 
//     : !isDeepEqual(columnsViewLocalStorage, defaultView)
//     ? !isDeepEqual(columnsViewLocalStorage, project.section)
//     :true;


//     // if no unsaved changes, then just return either the userAppliedView or default view. 
//     if (!areColumnsDifferent){
//         console.log(`------> No unsaved chanegs found for project:${project.title}`)
//         return columnViewInDB as any[]
//     } 
//     if (!isDeepEqual(columnsViewLocalStorage, project.section)) console.log(`Found out of sync changes for project:${project.title}`)
//     const {synced} = syncColumnsWithProject(columnsViewLocalStorage, project.section??[]);
//     console.log("--------------> There are unsaved changes for project:"+ project.title, + ". So, we'll sync live and local")
//     console.log("--------------> for reference: the live version: ", project.section)
//     console.log("--------------> for reference: the local version: ", columnsViewLocalStorage)

//     console.log("+-+ ---------------> *Synced* version: ", synced)
//     console.log("+-+ ------------------------------------------------------------------------------------------------------------")

//     setBoardColumnsViewAndReturn(project.id, synced)
//     return synced
//     // IF there are unsaved changes, then first we need to make sure the following:
//     // 1. if there are any sections that are present in the localstorage, that are NOT in project.section
//     // 2. if there are any sections that are NOT present in localstorage but PRESENT in project.section

    
// }

// =================== upsert the board columns 
// export const upsertBoardColumnsViewAndReturn = (project?: IProject | null) => {
//     if (!project) return;
//     let sortingModeInLocalstorage = getColumnViewForProject(project.id)
//     const { userAppliedView, defaultView } = getBoardAndUserAppliedColumnView(project)


//     // added bang here because WE ARE SURE, that the value exists, it goes way back when it was first introduced.
//     // no worries though, if project.section exists, then the sections inside them will contain all these values
//     const projectColumnsDefault = project.section ? reshapeBoardColumnsForViews(project.section) : []
//     const fallBackColumns = userAppliedView ?? defaultView 
//     if (!sortingModeInLocalstorage) setBoardColumnsViewAndReturn(project.id, fallBackColumns)
//     return sortingModeInLocalstorage ?? fallBackColumns
// }

// ==================== get the default and user applied column view
// export const getBoardAndUserAppliedColumnView = (_currentProject: IProject) => {
//     const defaultView = _currentProject.project_view?.default_view?.board_columns_view
//     // console.log("🚀 ~ getBoardAndUserAppliedView ~ defaultView:", defaultView)
//     const userAppliedView = _currentProject.project_view?.user_project_views[0]?.appliedView?.board_columns_view
//     // console.log("🚀 ~ getBoardAndUserAppliedView ~ userAppliedView:", userAppliedView)
//     return { userAppliedView, defaultView }


// }

//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// ========================== BOARD SORTING FUNCTIONS 

// IF in a case where we don't have a view in the localstorage, we check for the applied, then default.
// export const upsertBoardSortingViewAndReturn = (project?: IProject | null): TBoardSortingViewMode => {
//     if (!project) return defaultBoardSortingSettings
//     // const view = project.project_view?.user_project_views[0]
//     // if (!view) return "Manual"
//     // const unsaved = view.unsavedView?.board_sorting_mode
//     // const applied = view.appliedView?.board_sorting_mode
//     // const defaultView = project.project_view?.default_view?.board_sorting_mode
//     // return unsaved??applied??defaultView??"Manual"
//     let sortingModeInLocalstorage = getSortingViewForProject(project.id)
//     const { userAppliedView, defaultView } = getBoardAndUserAppliedSortingView(project)
//     const fallbackSorting = userAppliedView ?? defaultView ?? defaultBoardSortingSettings
//     return sortingModeInLocalstorage ?? fallbackSorting
// }


// =======================================================================================
// =======================================================================================
// =======================================================================================
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

  // HTPR-5047: column ORDER lives on Section.ranking, not in the view. Both
  // reorder paths (board drag and Manage Columns) write the ranking and the
  // view array, so the two can only disagree when one of those writes fails.
  // When they do, the stored array wins and the column snaps back on reload.
  // Order by the canonical ranking here and the divergence cannot surface:
  // the view array still decides which columns are visible, just not where
  // they sit. Columns whose section is gone keep their stored order, last.
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

  // View JSON predates isDone and agent auto-assignment on existing boards.
  // Overlay the canonical Section settings so stale view snapshots cannot hide
  // a saved value in the Manage columns editor.
  return ordered.map((column) => {
    const section = sectionsById.get(column.id ?? column.sectionId);
    return section
      ? {
          ...syncSectionAutoAssignFromCanonical(column, section),
          isDone: section.isDone,
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

// The raw per-view override: true/false when a view pinned it, null when every
// view in the chain inherits. Save bodies must carry THIS, not the resolved
// value, or saving any unrelated setting would freeze the board default into
// the view and later board-level changes would stop reaching it.
export const getActiveStalenessOverrideFromProject = (project?:IProject|null):boolean|null=>{
    const view = project?.project_view?.user_project_views?.[0]
    const unsaved = view?.unsavedView?.board_staleness
    const applied = view?.appliedView?.board_staleness
    const defaultView = project?.project_view?.default_view?.board_staleness
    return unsaved ?? applied ?? defaultView ?? null
}

// What the board actually renders: the view override, else the board setting.
export const getActiveStalenessFromProject = (project?:IProject|null):boolean=>{
    return getActiveStalenessOverrideFromProject(project) ?? !!project?.stalenessEnabled
}

// Same override/inherit split as staleness: true/false when a view pinned
// "show archived tasks", null when nothing in the chain did. Save bodies must
// carry THIS, never the resolved value.
export const getActiveShowArchivedOverrideFromProject = (project?:IProject|null):boolean|null=>{
    const view = project?.project_view?.user_project_views?.[0]
    const unsaved = view?.unsavedView?.board_show_archived
    const applied = view?.appliedView?.board_show_archived
    const defaultView = project?.project_view?.default_view?.board_show_archived
    return unsaved ?? applied ?? defaultView ?? null
}
// Resolve what "show archived" should render right now. A pending toggle wins:
// the view write is async, so until it lands the saved override still reports
// the old value and a second toggle would re-send the first one's result
// (HTPR-5540).
export const resolveShowArchivedForBoard = (
    project: IProject | null | undefined,
    pending: { projectId: number; value: boolean } | null,
    browserPreference: boolean
): boolean => {
    if (pending && project && pending.projectId === project.id) return pending.value
    return getActiveShowArchivedOverrideFromProject(project) ?? browserPreference
}


export const getActiveFiltersFromProject = (project?:IProject|null):IFilterSettings=>{
    const view = project?.project_view?.user_project_views[0]
    if (!project || !view) return defaultFilterSettings
    const unsaved = view.unsavedView?.board_filters as IFilterSettings
    const applied = view.appliedView?.board_filters as IFilterSettings
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

export const getActiveEmptySectionSettingFromProjectView = (
  projectView?: IProjectView,
): TBoardEmptySections => {
  const view = projectView?.user_project_views[0]
  const unsaved = view?.unsavedView?.board_empty_sections
  const applied = view?.appliedView?.board_empty_sections
  const defaultView = projectView?.default_view?.board_empty_sections
  return deepCopy(unsaved??applied??defaultView??'Show')
}

export const getActiveEmptySectionSettingFromProject = (project?:IProject|null):TBoardEmptySections=>
  getActiveEmptySectionSettingFromProjectView(project?.project_view)

export const patchProjectViewEmptySections = (
  projectView: IProjectView,
  setting: TBoardEmptySections,
): IProjectView => {
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
}

export type TEmptySectionMutationState = {
  baseline: TBoardEmptySections
  pending: TPendingEmptySectionMutation[]
}

export const beginEmptySectionMutation = (
  state: TEmptySectionMutationState | undefined,
  projectView: IProjectView,
  mutation: TPendingEmptySectionMutation,
): { state: TEmptySectionMutationState; projectView: IProjectView } => ({
  state: {
    baseline: state?.baseline ?? getActiveEmptySectionSettingFromProjectView(projectView),
    pending: [...(state?.pending ?? []), mutation],
  },
  projectView: patchProjectViewEmptySections(projectView, mutation.setting),
})

export const settleEmptySectionMutation = (
  state: TEmptySectionMutationState,
  mutationId: number,
  succeeded: boolean,
  authoritativeView: IProjectView,
): { state?: TEmptySectionMutationState; projectView: IProjectView } => {
  const pending = state.pending.filter((mutation) => mutation.id !== mutationId)
  const baseline = succeeded
    ? getActiveEmptySectionSettingFromProjectView(authoritativeView)
    : state.baseline
  const latest = pending[pending.length - 1]

  if (latest) {
    return {
      state: { baseline, pending },
      projectView: patchProjectViewEmptySections(authoritativeView, latest.setting),
    }
  }

  return {
    projectView: succeeded
      ? authoritativeView
      : patchProjectViewEmptySections(authoritativeView, baseline),
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
  // Pick the active VIEW first, then read its stack. The sibling getters above can cascade on the
  // value because board_sorting_mode/_order are NOT NULL, so the active view always supplies one.
  // board_sorting_stack is nullable and null is the normal state for every pre-existing view, so a
  // value cascade would fall through and inherit another view's tie-breakers.
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

// Mirrors resolveBoardLayoutRequest: a partial caller that never mentions
// board_show_archived must keep the view's pinned choice, while an explicit
// null means "inherit" (HTPR-5540).
export const resolveShowArchivedRequest = (
    source: unknown,
    inherited: boolean | null,
): boolean | null => {
    if (!source || typeof source !== "object") return inherited
    if (!Object.prototype.hasOwnProperty.call(source, "board_show_archived")) return inherited
    const value = (source as Record<string, unknown>).board_show_archived
    // The route has no schema validation, so coerce rather than hand a stray
    // string straight to the Prisma boolean column.
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
        // Preserve unsavedView exactly. URL-aware tabs keep synthetic
        // tab-unsaved overlays here that do not exist in the server response.
        user_project_views: projectView.user_project_views.map((row) => ({
            ...row,
            appliedView: patchView(row.appliedView),
        })),
    };
};

// Shared links can explicitly override either surface. Bare links keep the
// per-view/browser inheritance contract instead of silently preferring Board.
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

// Unsaved-view controls are rendered by several hook instances and send full
// settings snapshots. Keep one queue per project so cross-field responses
// cannot complete out of order and overwrite a newer layout/settings state.
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

// Select the active view first. Null is meaningful (inherit the browser
// preference), so it must not cascade into another view's stored value.
export const getActiveBoardLayoutPreferenceFromProject = (
    project?: IProject | null,
): TSavedBoardLayout | null => {
    const row = project?.project_view?.user_project_views?.[0];
    const activeView = row?.unsavedView ?? row?.appliedView ?? project?.project_view?.default_view;
    return sanitizeBoardLayout(activeView?.board_layout);
};

export const getActiveTableSortFromProject = (project?: IProject | null): TTableSort => {
    const view = project?.project_view?.user_project_views?.[0]
    // Pick the active view before reading its fields. A null table sort means
    // "show section groups with no flat-table sort"; cascading each value
    // separately would resurrect the applied/default view's previous sort
    // when an unsaved view explicitly cleared it.
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

// Imported rather than copied. This list used to be duplicated here with a
// "keep in sync" comment, on the grounds that a server-safe util must not pull
// in the Recoil atom module. TABLE_COLUMN_KEYS has since moved to a pure
// helper with no imports at all, so the copy bought nothing and cost a bug:
// "created" was added to one list and not the other, and every Created sort
// was silently sanitized to null (HTPR-5164).
const STATIC_TABLE_SORT_COLUMN_KEYS = new Set<string>(TABLE_COLUMN_KEYS)
// Board-defined custom fields use a dynamic customField:<uuid> key, so
// TABLE_SORT_COLUMN_KEYS.has() below also matches that pattern.
const TABLE_SORT_COLUMN_KEYS = {
    has: (column: string) => STATIC_TABLE_SORT_COLUMN_KEYS.has(column) || /^customField:[0-9a-f-]{36}$/i.test(column),
}
const TABLE_SORT_DIRECTIONS = new Set(["asc", "desc"])

// Validates a raw table-sort payload from a view-settings API body; anything
// unrecognized is dropped to null rather than persisted.
export const sanitizeTableSort = (column: unknown, direction: unknown): { column: string | null; direction: string | null } => ({
    column: typeof column === "string" && TABLE_SORT_COLUMN_KEYS.has(column) ? column : null,
    direction: typeof direction === "string" && TABLE_SORT_DIRECTIONS.has(direction) ? direction : null,
})

export const getViewFromProject = (project?: any | null): IViewType | undefined=> {
  if (!project) return undefined
  const view = project.project_view?.user_project_views[0]
  const unsaved = view?.unsavedView
  const applied = view?.appliedView
  const defaultView = project.project_view?.default_view
  if(unsaved) return {view: unsaved, type: "Unsaved"};
  else if(applied) return {view: applied, type: "Applied"};
  else if(defaultView) return {view: defaultView, type: "Default"};
  return undefined
}

export const pinProjectToUrlView = (project: IProject, viewSlug?: string | null) => {
  if (!viewSlug) return project
  const projectView = project.project_view
  const userProjectView = projectView?.user_project_views?.[0]
  const targetView = projectView?.allViews?.find((view) => view.slug === viewSlug)
  if (!projectView || (!targetView && viewSlug !== "default")) return project

  if (userProjectView) {
    const appliedOrDefaultView = userProjectView.appliedView ?? projectView.default_view
    // Tabs pinned to the same view intentionally share one unsaved working context.
    if (targetView && appliedOrDefaultView?.id === targetView.id) return project
    // A tab pinned to the default sentinel with no applied view is already on
    // the default base, so its unsaved overlay IS this tab's working context,
    // the same rule as pinning to a named view's own base above. Clearing it
    // hid the Save-view affordance after any sort/filter change on the default
    // view, because the URL always carries view=default there (HTPR-5900).
    if (
      !targetView &&
      !userProjectView.appliedView &&
      !userProjectView.appliedViewId
    ) return project
  }

  const isDefaultView = !targetView ||
    targetView.id === projectView.default_view_id ||
    targetView.id === projectView.default_view?.id
  // The synthesized row intentionally omits DB row fields consumers never read.
  const userProjectViewOverride = (
    userProjectView
      ? {
        ...userProjectView,
        appliedView: isDefaultView ? undefined : targetView,
        appliedViewId: isDefaultView ? undefined : targetView.id,
        unsavedView: undefined,
        unsavedViewId: undefined,
      }
      : {
        appliedView: isDefaultView ? undefined : targetView,
        appliedViewId: isDefaultView ? undefined : targetView.id,
        unsavedView: undefined,
        unsavedViewId: undefined,
      }
  ) as unknown as IUserProjectView
  const pinnedProject = {
    ...project,
    project_view: {
      ...projectView,
      user_project_views: [
        userProjectViewOverride,
        ...projectView.user_project_views.slice(1),
      ],
    },
  }

  let filteredSections = getFilteredSections(pinnedProject.sections ?? [], pinnedProject)
  filteredSections = getAppliedSubtaskSections(filteredSections, pinnedProject)
  filteredSections = getFilteredEmptySections(filteredSections, pinnedProject)
  pinnedProject.filteredSections = filteredSections
  return pinnedProject
}

// =======================================================================================
// =======================================================================================
// =======================================================================================


// ======== sets view settings for sorting view
// export const setBoardSortingViewAndReturn = async (project: IProject, mode: TBoardSortingViewMode) => {
//     const active_filters = getActiveFiltersFromProject(project)
//     const active_columns = getActiveColumnsViewFromProject(project)

//     const response = await axios.post("/api/projects/views/unsaved-view",{
//         projectId:project.id,
//         board_columns_view:active_columns, 
//         board_sorting_mode:mode, 
//         board_filters:active_filters

//     })
//     return response.data

// }
// // ======= set a new value and return it
// export const setBoardColumnsViewAPI = async(project:IProject, columnsToUpdate:ISection[]) => {
//     const active_filters = getActiveFiltersFromProject(project)
//     const sorting_mode_current = getActiveSortingModeFromProject(project)
//     const response = await axios.post("/api/projects/views/unsaved-view",{
//         projectId:project.id,
//         board_columns_view:columnsToUpdate, 
//         board_sorting_mode:sorting_mode_current, 
//         board_filters:active_filters

//     })
//     return response.data

// }

// export const saveFilterAPI = async(project:IProject, filterForThisProject:IFilterSettings)=>{
//     const active_columns = getActiveColumnsViewFromProject(project)
//     const sorting_mode_current = getActiveSortingModeFromProject(project)

//     const response = await axios.post("/api/projects/views/unsaved-view",{
//         projectId:project.id,
//         board_columns_view:active_columns, 
//         board_sorting_mode:sorting_mode_current, 
//         board_filters:filterForThisProject

//     })
//     return response.data

// } 

export const getBoardAndUserAppliedSortingView = (_currentProject: IProject) => {
    const defaultView = _currentProject.project_view?.default_view?.board_sorting_mode
    const userAppliedView = _currentProject.project_view?.user_project_views[0]?.appliedView?.board_sorting_mode
    return { userAppliedView, defaultView }


}
