import { IProject, ITask } from "@/models/model";
import { RefObject } from "react";
import { FilterCommandMode } from "./enums";

export interface IGetBoardAppliedViewReturnBody {
  userAppliedView: IFilterSettings | undefined;
  defaultView: IFilterSettings | undefined;
}

export interface IFilterModalProps {
      handleAction: (mode?: FilterCommandMode) => void;
      toggleFilterMatchOptions: () => void;
      view: "Kanban" | "Calendar";
}
export interface IFilterCommandList {
    key: string;
    name: string;
    type:TFilter|FilterCommandMode;
    commandMode: FilterCommandMode;
}

export type TFilterCommandComponents = {
    [key in FilterCommandMode]: React.ReactNode;
  };



export interface IFilterCommandRowEl {
    el:IFilterCommandList
    activeFilters: IFilterSettings
}

// Define the filter structure
export type TFilter = "Labels" | "Assignees" | "BlockedByPerson" | "UpdatedBy" | "CreatedBy" | "Priority" | "Size" | "Status" | "Inbox" | "Unread" | "UpdatedRange" | "CreatedAt" |"DueDate"|"Starred"|"NoRecentComment"|"StuckInColumn"|"RunningTimer"|"StaleOnBoard"|"NotStale";
export type TMatchFilters = "ALL"|"ANY";
export interface IFilterRuntimeContext {
  runningTaskIds?: ReadonlySet<number>;
}
// `match` is appended last on purpose: `project` was already the third argument and callers outside
// applyFilters (the staleness tests) pass it positionally. `runtimeContext` follows the same rule and
// stays last. It carries live, non-persisted values a condition cannot read off the task itself.
export type TCondition = (item: ITask, value: any, project?: IProject, match?: TMatchFilters, runtimeContext?: IFilterRuntimeContext) => boolean;
export interface IFilter {
  type: TFilter;
  searchPayload: any[];
  condition: TCondition
  /** How this filter's own values combine. Absent = ANY, which is today's behaviour. */
  match?: TMatchFilters;
};

/** Filters where ONE task can hold several values, so "has all of these" is meaningful.
 *  Priority/Size/CreatedBy are single-valued per task — ALL there would always be empty.
 *  UpdatedBy is excluded too: its agent branch compares the task's single `agentId`, so ALL with
 *  two agents can never match, and the picker offers no way to see why the board went empty. */
export const MULTI_VALUE_FILTERS: TFilter[] = ["Labels", "Assignees"];
export const supportsMatchMode = (type: TFilter) => MULTI_VALUE_FILTERS.includes(type);

export interface IFilterSettings{
  matchFilters :TMatchFilters;
  addedFilters:IFilter[]
}



export interface FilterCommandListProps {
    // groupIndex:number;
    // commandLists: ICommandList[];
    // selectedIdx: number;
    handleAction: (commandMode: FilterCommandMode, key: string) => void;
    handleMouseLeave: () => void;
    handleMouseEnter: (index: number, groupIndex:number) => void;
    commandRef: RefObject<HTMLDivElement | null>;
    onClickHandler:any

}


export interface IValuePropUpdatedAt{
  
    selectedDate: string | null, 
    fromDate: string | null, 
    toDate: string | null, 
    condition: 'BEFORE' | 'AFTER' | 'ANY' |  null
    dynamicRange?: "TODAY" | "YESTERDAY" | "LAST_7_DAYS" | "LAST_30_DAYS" | "THIS_WEEK" | "THIS_MONTH" | "OVERDUE" | "NEXT_7_DAYS" | "NO_DUE_DATE" | null;

  
}
