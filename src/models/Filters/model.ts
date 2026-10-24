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
      view: "Kanban" | "Calendar" | "MyTasks";
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

export type TFilter = "Labels" | "Assignees" | "BlockedByPerson" | "UpdatedBy" | "CreatedBy" | "Priority" | "Size" | "Status" | "Inbox" | "Unread" | "UpdatedRange" | "CreatedAt" |"DueDate"|"Starred"|"NoRecentComment"|"StuckInColumn"|"RunningTimer"|"StaleOnBoard"|"NotStale";
export type TMatchFilters = "ALL"|"ANY";
export interface IFilterRuntimeContext {
  runningTaskIds?: ReadonlySet<number>;
  humanAssigneesOnly?: boolean;
}
export type TCondition = (item: ITask, value: any, project?: IProject, match?: TMatchFilters, runtimeContext?: IFilterRuntimeContext) => boolean;
export interface IFilter {
  type: TFilter;
  searchPayload: any[];
  condition: TCondition
  match?: TMatchFilters;
};

export const MULTI_VALUE_FILTERS: TFilter[] = ["Labels", "Assignees"];
export const supportsMatchMode = (type: TFilter) => MULTI_VALUE_FILTERS.includes(type);

export interface IFilterSettings{
  matchFilters :TMatchFilters;
  addedFilters:IFilter[]
}



export interface FilterCommandListProps {
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
