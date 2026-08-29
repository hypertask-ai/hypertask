import { FilterCommandMode } from "@/models/Filters/enums";
import { IFilterCommandList } from "@/models/Filters/model";

export const filterCommandLists: IFilterCommandList[] = [
  {
    key: "clearAll",
    name: "Clear all filters",
    type: FilterCommandMode.ClearAll,
    commandMode: FilterCommandMode.ClearAll,
  },
  {
    key: "matchAllorAny",
    name: "Toggle Match Criteria",
    type: FilterCommandMode.ToggleMatchCriterai,
    commandMode: FilterCommandMode.ToggleMatchCriterai,
  },
  {
    key: "UpdatedBy",
    name: "Updated by",
    type: "UpdatedBy",
    commandMode: FilterCommandMode.UpdatedBy,
  },
  {
    key: "CreatedBy",
    name: "Created by",
    type: "CreatedBy",
    commandMode: FilterCommandMode.CreatedBy,
  },
  {
    key: "Unread",
    name: "Has unread notifications",
    type: "Unread",
    commandMode: FilterCommandMode.Unread,
  },
  {
    key: "AssigneeToMe",
    name: "Tasks assigned to me",
    type: "Assignees",
    commandMode: FilterCommandMode.AssignedToMe,
  },
  {
    key: "DueDate",
    name: "Due date",
    type: "DueDate",
    commandMode: FilterCommandMode.DueDate,
  },

  {
    key: "Priority",
    name: "Priority",
    type: "Priority",
    commandMode: FilterCommandMode.Priority,
  },
  {
    key: "Assignees",
    name: "Assignees",
    type: "Assignees",
    commandMode: FilterCommandMode.Assignees,
  },
  {
    key: "BlockedByPerson",
    name: "Blocked by person",
    type: "BlockedByPerson",
    commandMode: FilterCommandMode.BlockedByPerson,
  },
  {
    key: "Tags",
    name: "Tags",
    type: "Labels",
    commandMode: FilterCommandMode.Labels,
  },
  {
    key: "Size",
    name: "Task Size",
    type: "Size",
    commandMode: FilterCommandMode.Size,
  },
  {
    key: "UpdatedAt",
    name: "Date updated at",
    type: "UpdatedRange",
    commandMode: FilterCommandMode.UpdatedRange,
  },

  {
    key: "CreatedAt",
    name: "Date created at",
    type: "CreatedAt",
    commandMode: FilterCommandMode.CreatedAt,
  },
  {
    key: "inInbox",
    name: "Present in inbox",
    type: "Inbox",
    commandMode: FilterCommandMode.InInbox,
  },
  {
    key: "NoRecentComment",
    name: "Stale without comment",
    type: "NoRecentComment",
    commandMode: FilterCommandMode.NoRecentComment,
  },
  {
    key: "StuckInColumn",
    name: "Stale in column",
    type: "StuckInColumn",
    commandMode: FilterCommandMode.StuckInColumn,
  },
  {
    key: "RunningTimer",
    name: "Has a running timer",
    type: "RunningTimer",
    commandMode: FilterCommandMode.RunningTimer,
  },
  {
    key: "StaleOnBoard",
    name: "Stale on board",
    type: "StaleOnBoard",
    commandMode: FilterCommandMode.StaleOnBoard,
  },
  {
    key: "NotStale",
    name: "Not stale",
    type: "NotStale",
    commandMode: FilterCommandMode.NotStale,
  },
];
