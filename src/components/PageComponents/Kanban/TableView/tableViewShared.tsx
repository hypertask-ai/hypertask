import { IProject, ISection, ITask } from "@/models/model";
import type { MyTasksSortField, MyTasksViewConfig } from "@/models/MyTasksView";
import { TBoardSortingViewMode } from "@/models/Views/model";
import type { SortingOrder } from "@prisma/client";
import type { CustomFieldType } from "@prisma/client";
import { sortByAssigneeOrder, sortByDueDateOrder, sortByPriorityAndRankingOrder, sortBySizeAndRankingOrder, sortByUpdatedAtOrder } from "@/utils/helperFunctions/helperFunctions";
import UserAvatar from "@/components/Common/UserAvatar";
import { type TaskShortcutAction } from "@/lib/keyboard/taskShortcuts";
import { CommandMode } from "@/models/enums";
import { daysSince } from "@/lib/staleness";
import { getActiveTableSortFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { displayedBoardTimeSeconds } from "@/lib/boardTimeTotals";



export const SECTION_CAP = 20;

export const TABLE_GRID_CLASS = "grid";

export const LABEL_CLASS = "border-border-labelComponent text-label-component";

export const MIN_COLUMN_WIDTH_PX = 60;

export type TaskRow = { type: "task"; task: ITask; sid: string | number };

export type Row = TaskRow | { type: "more"; sid: string | number; hidden: number };

export type StaticSortColumn = "ticket" | "title" | "board" | "status" | "assignee" | "priority" | "size" | "labels" | "due" | "inColumn" | "noComment" | "onBoard" | "time" | "created" | "updated";

export type CustomFieldSortColumn = `customField:${string}`;

export type SortColumn = StaticSortColumn | CustomFieldSortColumn;

export type SortDirection = "asc" | "desc";

export type SortState = { column: SortColumn; direction: SortDirection }[];

export type TableViewProps = {
  filteredSections?: ISection[];
  _sections: ISection[];
  _currentProject: IProject | null;
  _activeSortingMode: TBoardSortingViewMode;
  currentUser: any;
  handleBoardChange?: (index: number, sectionsFromCallback: ISection[]) => void;
  myTasksSort?: MyTasksViewConfig["sort"];
  myTasksSortKey?: number | null;
  /** HTPR-6461: My Tasks Remind Me also hides the row until that date. */
  myTasksSnoozeActive?: boolean;
  onMyTasksSortChange?: (sort: MyTasksViewConfig["sort"]) => void;
  /** Controlled My Tasks columns. When set, never reads/writes the board localStorage atom. */
  myTasksVisibleColumns?: string[];
  onMyTasksVisibleColumnsChange?: (columns: string[]) => void;
  /** Explicit My Tasks opt-in. Never inferred from a null project (HTPR-6444). */
  enableMyTasksBulkSelection?: boolean;
};

export const TASK_SHORTCUT_COMMAND_MODES: Partial<
  Record<TaskShortcutAction, CommandMode>
> = {
  delete: CommandMode.DeleteTask,
  size: CommandMode.EstimateModal,
  priority: CommandMode.PriorityModal,
  dueDate: CommandMode.SetDueDate,
  label: CommandMode.LabelModal,
  share: CommandMode.ShareTaskPublic,
  moveColumn: CommandMode.MoveToColumn,
  moveBoard: CommandMode.MoveTaskToBoard,
  rename: CommandMode.RenameTask,
};

export type CustomField = { id: string; name: string; type: CustomFieldType; showInTable?: boolean | null };

export type CustomFieldValue = { fieldId: string; value: string; numericValue: number | null };

export type TableColumn = { key: SortColumn; label: string; width: string; className?: string };

export const DEFAULT_DESC = new Set<StaticSortColumn>(["priority", "size", "time", "created", "updated", "inColumn", "noComment", "onBoard"]);

export const customFieldSortColumn = (fieldId: string): CustomFieldSortColumn => `customField:${fieldId}`;

export const isCustomFieldSortColumn = (column: string): column is CustomFieldSortColumn =>
  /^customField:[0-9a-f-]{36}$/i.test(column);

export const customFieldIdFromSortColumn = (column: CustomFieldSortColumn) => column.slice("customField:".length);

export const initialDirection = (column: SortColumn, customFieldBySortColumn: Map<SortColumn, CustomField>): SortDirection =>
  DEFAULT_DESC.has(column as StaticSortColumn) || customFieldBySortColumn.get(column)?.type === "Number" ? "desc" : "asc";

export const isTaskRow = (row: Row): row is TaskRow => row.type === "task";

export const tableColumns: TableColumn[] = [
  { key: "ticket", label: "Ticket", width: "90px" },
  { key: "title", label: "Title", width: "minmax(200px,1fr)" },
  { key: "board", label: "Board", width: "120px" },
  { key: "status", label: "Status", width: "110px" },
  { key: "assignee", label: "Assignee", width: "64px" },
  { key: "priority", label: "Priority", width: "100px" },
  { key: "size", label: "Size", width: "80px" },
  { key: "labels", label: "Labels", width: "140px" },
  { key: "due", label: "Due", width: "104px" },
  { key: "inColumn", label: "In column", width: "84px" },
  { key: "noComment", label: "No comment", width: "92px" },
  { key: "onBoard", label: "On board", width: "80px" },
  { key: "time", label: "Time", width: "88px", className: "text-right" },
  { key: "created", label: "Created", width: "96px", className: "text-right" },
  { key: "updated", label: "Updated", width: "88px", className: "text-right" },
];

export const tableColumnByKey = new Map(tableColumns.map((column) => [column.key, column]));

// The Created column shows a real date rather than an age: "oldest ticket" is
// the question it exists to answer, and "412d" does not answer it (HTPR-5129).
export const createdAtMs = (task: ITask): number => {
  const value = task.createdAt ? new Date(task.createdAt).getTime() : NaN;
  return Number.isNaN(value) ? 0 : value;
};


// Extracts the numeric px a column's default CSS width track starts from,
// whether it's a plain "90px" or the title's "minmax(200px,1fr)" — used both
// as the fallback when no drag-resize override is stored and to size the
// horizontal-scroll min-width below.
export const baseColumnWidthPx = (width: string): number => {
  const raw = width.startsWith("minmax(") ? width.slice(7) : width;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : MIN_COLUMN_WIDTH_PX;
};


// The DB stores generic strings (already validated server-side); re-check
// against the table's own column keys before trusting them as SortState.
// Only the primary (level 1) sort persists to the view today; secondary
// tie-break levels added via shift-click are local-only, see toggleSort.
export const resolveSortState = (project?: IProject | null): SortState => {
  const active = getActiveTableSortFromProject(project);
  if (!active) return [];
  if (active.column === "time" && !project?.showTimeTotals) return [];
  if (!tableColumnByKey.has(active.column as SortColumn) && !isCustomFieldSortColumn(active.column)) return [];
  if (active.direction !== "asc" && active.direction !== "desc") return [];
  return [{ column: active.column as SortColumn, direction: active.direction }];
};


export const resolveMyTasksSortState = (sort: MyTasksViewConfig["sort"]): SortState => {
  const columns: Partial<Record<MyTasksSortField, SortColumn>> = {
    dueDate: "due",
    priority: "priority",
    createdAt: "created",
    updatedAt: "updated",
    title: "title",
  };
  const column = columns[sort.field];
  return column ? [{ column, direction: sort.direction }] : [];
};


export const myTasksSortFromTable = (
  sort: SortState[number] | undefined,
): MyTasksViewConfig["sort"] | null => {
  if (!sort) return null;
  const fields: Partial<Record<SortColumn, MyTasksSortField>> = {
    due: "dueDate",
    priority: "priority",
    created: "createdAt",
    updated: "updatedAt",
    title: "title",
  };
  const field = fields[sort.column];
  return field ? { field, direction: sort.direction } : null;
};


export const taskInColumnDays = (t: ITask) => daysSince(t.sectionChangedAt ?? t.createdAt);

export const taskNoCommentDays = (t: ITask) => daysSince(t.lastCommentAt ?? t.createdAt);

export const taskOnBoardDays = (t: ITask) => daysSince(t.createdAt);


// tieBreakByRanking must be false for every level except the last: ranking is unique per task, so
// leaving it on makes the priority/size comparators never report a tie and the levels below them
// would never get a say.
// Direction is handled here, not by negating the result: priority/size/due/updated
// keep empty values last in BOTH directions, and negating the whole comparator
// would flip that "missing last" branch too, floating the blanks to the top
// (HTPR-4629). Only the columns with no empty state get the cheap flip.
export const getCustomFieldValue = (task: ITask, fieldId: string) =>
  (task as ITask & { customFieldValues?: CustomFieldValue[] }).customFieldValues?.find((value) => value.fieldId === fieldId);


export const getSortComparator = (
  column: SortColumn,
  direction: SortDirection,
  customFieldBySortColumn: Map<SortColumn, CustomField>,
  sectionOrder?: Map<string | number, number>,
  tieBreakByRanking = true,
  timeTotals = new Map(),
  nowMs = Date.now(),
) => {
  const order: SortingOrder = direction === "desc" ? "Descending" : "Ascending";
  const flip = direction === "desc" ? -1 : 1;
  if (isCustomFieldSortColumn(column)) {
    const field = customFieldBySortColumn.get(column);
    const fieldId = customFieldIdFromSortColumn(column);
    return (a: ITask, b: ITask) => {
      const valueA = getCustomFieldValue(a, fieldId);
      const valueB = getCustomFieldValue(b, fieldId);
      const comparableA = field?.type === "Number" || field?.type === "Date" ? valueA?.numericValue : valueA?.value;
      const comparableB = field?.type === "Number" || field?.type === "Date" ? valueB?.numericValue : valueB?.value;
      if (comparableA == null && comparableB == null) return 0;
      if (comparableA == null) return 1;
      if (comparableB == null) return -1;
      if (typeof comparableA === "number" && typeof comparableB === "number") return flip * (comparableA - comparableB);
      return flip * String(comparableA).localeCompare(String(comparableB));
    };
  }
  if (column === "ticket") return (a: ITask, b: ITask) => flip * (a.uniqueIndex - b.uniqueIndex);
  if (column === "title") return (a: ITask, b: ITask) => flip * (a.title || "").localeCompare(b.title || "");
  if (column === "status") {
    return (a: ITask, b: ITask) => {
      const orderA = sectionOrder?.get(a.sectionId ?? "") ?? Number.MAX_SAFE_INTEGER;
      const orderB = sectionOrder?.get(b.sectionId ?? "") ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return flip * (orderA - orderB);
      return flip * (a.section || "").localeCompare(b.section || "");
    };
  }
  if (column === "assignee") return sortByAssigneeOrder(order);
  if (column === "priority") return sortByPriorityAndRankingOrder(order, tieBreakByRanking);
  if (column === "size") return sortBySizeAndRankingOrder(order, tieBreakByRanking);
  if (column === "due") return sortByDueDateOrder(order);
  if (column === "inColumn") return (a: ITask, b: ITask) => flip * ((taskInColumnDays(a) ?? -1) - (taskInColumnDays(b) ?? -1));
  if (column === "noComment") return (a: ITask, b: ITask) => flip * ((taskNoCommentDays(a) ?? -1) - (taskNoCommentDays(b) ?? -1));
  if (column === "onBoard") return (a: ITask, b: ITask) => flip * ((taskOnBoardDays(a) ?? -1) - (taskOnBoardDays(b) ?? -1));
  if (column === "time") {
    return (a: ITask, b: ITask) =>
      flip *
      (displayedBoardTimeSeconds(timeTotals.get(a.id), nowMs) -
        displayedBoardTimeSeconds(timeTotals.get(b.id), nowMs));
  }
  // Sorts on the raw timestamp, not the rendered string, so a year-less label
  // never orders "02 Jan" above "12 Dec" of the previous year. Unparseable dates
  // fall to 0 and sort as oldest rather than scattering.
  if (column === "created") return (a: ITask, b: ITask) => flip * (createdAtMs(a) - createdAtMs(b));
  return sortByUpdatedAtOrder(order);
};


export const renderAssigneeAvatarsContent = (task: ITask) => {
  const assignees = task.assignees || [];
  if (!assignees.length) return null;

  const visibleAssignees = assignees.slice(0, 3);
  const hiddenCount = assignees.length - visibleAssignees.length;

  return (
    <div className="flex min-w-0 items-center">
      {visibleAssignees.map((assignee, index) => {
        // Agent first, like the Kanban/calendar cards: an agent assignment
        // also carries its owning user, who is not the real assignee.
        const user = assignee.agent ?? assignee.user;
        const displayName = user?.displayName || "";
        const label = displayName || "Assignee";
        const stackClass = index === 0 ? "ml-0" : "ml-[-8px]";

        return (
          <UserAvatar
            key={assignee.id}
            agentId={assignee.agent?.id}
            alt={label}
            className={`${stackClass} ring-1 ring-[var(--bg-containerBackground)]`}
            fallbackClassName="bg-active-elementBg text-text-light-gray"
            name={displayName}
            photoURL={user?.photoURL}
            size={20}
            title={label}
          />
        );
      })}
      {hiddenCount > 0 && (
        <span className="ml-1 flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-active-elementBg px-1 text-micro font-semibold text-text-light-gray">
          +{hiddenCount}
        </span>
      )}
    </div>
  );
};


export const renderAssigneeAvatars = (task: ITask) =>
  renderAssigneeAvatarsContent(task);
