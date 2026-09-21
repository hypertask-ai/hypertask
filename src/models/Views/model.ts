import { SortingMode, ViewVisibility, SubtaskSetting, SortingOrder, EmptySections } from "@prisma/client";
import { ISection } from "../model";
import { IFilterSettings } from "../Filters/model";

export type TBoardSortingViewMode = SortingMode
export type TBoardSortingViewOrder = SortingOrder
export type TBoardSortingLevel = { mode: TBoardSortingViewMode; order: TBoardSortingViewOrder };
export type TBoardSubtaskSetting = SubtaskSetting
export const DEFAULT_SUBTASK_SETTING: TBoardSubtaskSetting = "Flattened_Card"
export type TBoardEmptySections = EmptySections
export const PERSONAL_EMPTY_SECTIONS_UPDATE_MODE = "personal-empty-sections" as const
export const BOARD_EMPTY_SECTION_SETTINGS = Object.values(EmptySections) as EmptySections[]
export const isBoardEmptySectionSetting = (value: unknown): value is EmptySections =>
    BOARD_EMPTY_SECTION_SETTINGS.includes(value as EmptySections)
export type TSavedBoardLayout = "Board" | "Table"

const sortingModeLabels: Record<SortingMode, string> = {
    Priority: "Priority",
    DueDate: "Due Date",
    Size: "Size",
    UpdatedAt: "Last Updated",
    CreatedAt: "Creation Date",
    LastCommentAt: "Last comment",
    SectionChangedAt: "Column changed",
    Assignee: "Assignee",
    Title: "Title",
    TicketNumber: "Ticket number",
    TimeInColumn: "Time in column",
    TimeOnBoard: "Time on board",
    TimeWithoutComment: "Time without comment",
    Manual: "Manual",
}

export const sortingModeLabel = (mode: SortingMode): string => sortingModeLabels[mode]

// Derived from the enum so a new sorting mode reaches the MCP + AI-chat schemas on its own. The
// hand-written lists they used before had already drifted two modes behind the enum.
export const SORTING_MODES = Object.values(SortingMode) as [SortingMode, ...SortingMode[]]
export const SUBTASK_SETTINGS = Object.values(SubtaskSetting) as [SubtaskSetting, ...SubtaskSetting[]]

export function isSubtaskSetting(value: unknown): value is SubtaskSetting {
    return typeof value === "string" && SUBTASK_SETTINGS.includes(value as SubtaskSetting)
}


export type TCreate_view_body = {
    userId: number,
    projectId: number,
    view_settings: {
        board_columns_view?: any,
        board_filters?: any,
        board_sorting_mode?: SortingMode,
        board_sorting_order?: SortingOrder,
        board_sorting_stack?: TBoardSortingLevel[] | null,
        board_subtask_setting?: SubtaskSetting,
        board_empty_sections: EmptySections;
        board_staleness?: boolean | null,
        board_show_archived?: boolean | null,
        table_sort_column?: string | null,
        table_sort_direction?: string | null,
        board_layout?: TSavedBoardLayout | null,
    },
    setAsDefault: boolean,
    viewTitle: string;
    visibility:ViewVisibility

}
export type TUpdate_view_body = {
    projectId: number,
    view_settings: {
        board_columns_view?: any,
        board_filters?: any,
        board_sorting_mode?: SortingMode,
        board_sorting_order?: SortingOrder,
        board_sorting_stack?: TBoardSortingLevel[] | null,
        board_subtask_setting?: SubtaskSetting,
        board_empty_sections: EmptySections;
        board_staleness?: boolean | null,
        board_show_archived?: boolean | null,
        table_sort_column?: string | null,
        table_sort_direction?: string | null,
        board_layout?: TSavedBoardLayout | null,
    },
    viewId:string;
    

}

export type TBoardColumnView = {
    id: number;
    ranking: string;
    visibility: boolean;
    section_title: string;
}


export type TBodyAPIUnsaved = {
    projectId: number;
    board_columns_view: ISection[] | undefined;
    board_sorting_mode: SortingMode;
    board_sorting_order: SortingOrder;
    board_sorting_stack?: TBoardSortingLevel[] | null;
    board_filters: IFilterSettings;
    board_subtask_setting: SubtaskSetting;
    board_empty_sections: EmptySections;
    board_staleness?: boolean | null;
    board_show_archived?: boolean | null;
    table_sort_column?: string | null;
    table_sort_direction?: string | null;
    board_layout?: TSavedBoardLayout | null;
}
