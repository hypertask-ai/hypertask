"use client";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { IProject, ISection, ITask } from "@/models/model";
import { TBoardSortingViewMode } from "@/models/Views/model";
import { useShowArchivedOnBoard } from "@/hooks/Homepage/useShowArchivedOnBoard";
import { activeItemAtom, showCommandsAtom, tasksPlayListAtom, tableVisibleColumnsAtom, tableColumnWidthsAtom, tableTimeColumnSeededBoardsAtom, normalizeTableVisibleColumns, seedMissingCustomFieldColumns, customFieldColumnKey, isCustomFieldColumnKey, customFieldIdFromColumnKey, LOCKED_TABLE_COLUMNS } from "@/store";
import type { SortingOrder } from "@prisma/client";
import type { CustomFieldType } from "@prisma/client";
import {
  returnIfModalOrInputActive,
  returnSortedItems,
  sortByAssigneeOrder,
  sortByDueDateOrder,
  sortByPriorityAndRankingOrder,
  sortBySizeAndRankingOrder,
  sortByUpdatedAtOrder,
} from "@/utils/helperFunctions/helperFunctions";
import { SplitTitle } from "@/components/Common/TaskRowComponents/TaskListRow";
import UserAvatar from "@/components/Common/UserAvatar";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import useHypertasksNavigate from "@/hooks/MultiPages/Route/useHypertasksNavigate";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { isFavoriteBoardShortcut } from "@/lib/constants/shortcuts";
import { shouldRunArchiveShortcut } from "@/lib/keyboard/archiveShortcutGuard";
import type { IAllCommands } from "@/models/model";
import PriorityLabelComponent from "@/components/Modals/TaskPriority/PriorityLabelComponent";
import EstimateLabelComponent from "@/components/Modals/TaskEstimate/EstimateLabelComponent";
import DueDateLabel from "@/components/Labels/DueDateLabel";
import formatDateDifference, { formatDateWithYearIfPast } from "@/utils/generateTime";
import { daysSince, stalenessLevel } from "@/lib/staleness";
import { TriangleAlert } from "lucide-react";
import { BlockerTaskChip } from "@/components/PageComponents/Kanban/KanbanTaskComponents/BlockerChip";
import { getFilteredEmptySections } from "@/utils/helperFunctions/Views/EmptySectionsHelperFunction";
import { MAX_SORT_LEVELS, getActiveTableSortFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews";
import { toggleTaskTimer, useBoardRunningTimers, useTimerNow } from "@/hooks/Task Detail/useTimeTracking";
import { displayedBoardTimeSeconds } from "@/lib/boardTimeTotals";
import { formatElapsed } from "@/lib/timeDuration";
import toast from "react-hot-toast";
import axios from "axios";
import useMoveTaskToSection from "@/hooks/MultiPages/useMoveTaskToSection";
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import globalAPIHandlers from "@/utils/api/global";
import { useRouter } from "next/navigation";
import {
  canDropTableRow,
  getTableRowDragData,
  parseTableRowDragData,
  type TableRowDragData,
} from "./tableRowDrag";
import {
  createTaskFromTableSelection,
  tableSectionKey,
  tableSectionNumber,
} from "./tableCreateTask";
import {
  getTableCreateTaskControlProps,
  TableCreateTaskControl,
} from "./TableCreateTaskControl";

const HypertasksCommands = lazy(() => import("@/components/commands"));

type TableViewProps = { filteredSections?: ISection[]; _sections: ISection[]; _currentProject: IProject | null; _activeSortingMode: TBoardSortingViewMode; currentUser: any; handleBoardChange?: (index: number, sectionsFromCallback: ISection[]) => void };

const SECTION_CAP = 20;
const TABLE_GRID_CLASS = "grid";
const LABEL_CLASS = "border-border-labelComponent text-label-component";
const MIN_COLUMN_WIDTH_PX = 60;
type TaskRow = { type: "task"; task: ITask; sid: string | number };
type Row = TaskRow | { type: "more"; sid: string | number; hidden: number };
type StaticSortColumn = "ticket" | "title" | "status" | "assignee" | "priority" | "size" | "due" | "inColumn" | "noComment" | "onBoard" | "time" | "created" | "updated";
type CustomFieldSortColumn = `customField:${string}`;
type SortColumn = StaticSortColumn | CustomFieldSortColumn;
type SortDirection = "asc" | "desc";
type SortState = { column: SortColumn; direction: SortDirection }[];
type CustomField = { id: string; name: string; type: CustomFieldType; showInTable?: boolean | null };
type CustomFieldValue = { fieldId: string; value: string; numericValue: number | null };
type TableColumn = { key: SortColumn; label: string; width: string; className?: string };
const DEFAULT_DESC = new Set<StaticSortColumn>(["priority", "size", "time", "created", "updated", "inColumn", "noComment", "onBoard"]);
const customFieldSortColumn = (fieldId: string): CustomFieldSortColumn => `customField:${fieldId}`;
const isCustomFieldSortColumn = (column: string): column is CustomFieldSortColumn =>
  /^customField:[0-9a-f-]{36}$/i.test(column);
const customFieldIdFromSortColumn = (column: CustomFieldSortColumn) => column.slice("customField:".length);
const initialDirection = (column: SortColumn, customFieldBySortColumn: Map<SortColumn, CustomField>): SortDirection =>
  DEFAULT_DESC.has(column as StaticSortColumn) || customFieldBySortColumn.get(column)?.type === "Number" ? "desc" : "asc";
const isTaskRow = (row: Row): row is TaskRow => row.type === "task";
const tableColumns: TableColumn[] = [
  { key: "ticket", label: "Ticket", width: "90px" },
  { key: "title", label: "Title", width: "minmax(200px,1fr)" },
  { key: "status", label: "Status", width: "110px" },
  { key: "assignee", label: "Assignee", width: "64px" },
  { key: "priority", label: "Priority", width: "100px" },
  { key: "size", label: "Size", width: "80px" },
  { key: "due", label: "Due", width: "104px" },
  { key: "inColumn", label: "In column", width: "84px" },
  { key: "noComment", label: "No comment", width: "92px" },
  { key: "onBoard", label: "On board", width: "80px" },
  { key: "time", label: "Time", width: "88px", className: "text-right" },
  { key: "created", label: "Created", width: "96px", className: "text-right" },
  { key: "updated", label: "Updated", width: "88px", className: "text-right" },
];
const tableColumnByKey = new Map(tableColumns.map((column) => [column.key, column]));
// The Created column shows a real date rather than an age: "oldest ticket" is
// the question it exists to answer, and "412d" does not answer it (HTPR-5129).
const createdAtMs = (task: ITask): number => {
  const value = task.createdAt ? new Date(task.createdAt).getTime() : NaN;
  return Number.isNaN(value) ? 0 : value;
};

// Extracts the numeric px a column's default CSS width track starts from,
// whether it's a plain "90px" or the title's "minmax(200px,1fr)" — used both
// as the fallback when no drag-resize override is stored and to size the
// horizontal-scroll min-width below.
const baseColumnWidthPx = (width: string): number => {
  const raw = width.startsWith("minmax(") ? width.slice(7) : width;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : MIN_COLUMN_WIDTH_PX;
};

// The DB stores generic strings (already validated server-side); re-check
// against the table's own column keys before trusting them as SortState.
// Only the primary (level 1) sort persists to the view today; secondary
// tie-break levels added via shift-click are local-only, see toggleSort.
const resolveSortState = (project?: IProject | null): SortState => {
  const active = getActiveTableSortFromProject(project);
  if (!active) return [];
  if (active.column === "time" && !project?.showTimeTotals) return [];
  if (!tableColumnByKey.has(active.column as SortColumn) && !isCustomFieldSortColumn(active.column)) return [];
  if (active.direction !== "asc" && active.direction !== "desc") return [];
  return [{ column: active.column as SortColumn, direction: active.direction }];
};

const taskInColumnDays = (t: ITask) => daysSince(t.sectionChangedAt ?? t.createdAt);
const taskNoCommentDays = (t: ITask) => daysSince(t.lastCommentAt ?? t.createdAt);
const taskOnBoardDays = (t: ITask) => daysSince(t.createdAt);

// tieBreakByRanking must be false for every level except the last: ranking is unique per task, so
// leaving it on makes the priority/size comparators never report a tie and the levels below them
// would never get a say.
// Direction is handled here, not by negating the result: priority/size/due/updated
// keep empty values last in BOTH directions, and negating the whole comparator
// would flip that "missing last" branch too, floating the blanks to the top
// (HTPR-4629). Only the columns with no empty state get the cheap flip.
const getCustomFieldValue = (task: ITask, fieldId: string) =>
  (task as ITask & { customFieldValues?: CustomFieldValue[] }).customFieldValues?.find((value) => value.fieldId === fieldId);

const getSortComparator = (
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

export const renderAssigneeAvatars = (task: ITask) => {
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

// Right-edge drag handle for a header cell (feature 3: Excel-style column resize).
// A thin pointer-event hit strip, sibling to the sort <button> (not a child of
// it), so a resize drag never touches the button's draggable/click handlers.
// Sheets/Notion pattern (HTPR-4991): faint separators appear across the header
// row on hover, the hovered/dragged handle itself goes full accent, and a
// full-height guide line (rendered by the parent, positioned via containerRef)
// tracks the pointer for the duration of the drag.
const ColumnResizeHandle = ({
  column,
  width,
  onBeforeResize,
  onResize,
  containerRef,
  isResizing,
  onDragStateChange,
}: {
  column: string;
  width: number;
  // Excel model (HTPR-4993): title starts on a minmax(base,1fr) track that flexes
  // to absorb all spare width, so ANY other column's resize delta gets silently
  // swallowed by title instead of moving the dragged edge. Called at the start of
  // every resize drag (not just title's own) to freeze title to a fixed px track
  // — its real rendered width — if it isn't already; a no-op once frozen. Returns
  // the freshly-measured width when it just froze (so this drag, if it's title's
  // own, can start from that instead of the stale unflexed `width` prop).
  onBeforeResize: () => number | undefined;
  onResize: (column: string, width: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  isResizing: boolean;
  onDragStateChange: (left: number | null) => void;
}) => {
  const dragStart = useRef({ x: 0, width });

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const justFrozeTitleWidth = onBeforeResize();
      const startWidth = column === "title" && justFrozeTitleWidth !== undefined ? justFrozeTitleWidth : width;
      dragStart.current = { x: event.clientX, width: startWidth };
      document.body.style.userSelect = "none";
      const updateGuide = (clientX: number) => {
        const containerLeft = containerRef.current?.getBoundingClientRect().left ?? 0;
        onDragStateChange(clientX - containerLeft);
      };
      updateGuide(event.clientX);
      const onMove = (moveEvent: PointerEvent) => {
        onResize(column, dragStart.current.width + (moveEvent.clientX - dragStart.current.x));
        updateGuide(moveEvent.clientX);
      };
      const onUp = () => {
        document.body.style.userSelect = "";
        onDragStateChange(null);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [column, width, onBeforeResize, onResize, containerRef, onDragStateChange]
  );

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      draggable={false}
      onPointerDown={onPointerDown}
      onClick={(event) => event.stopPropagation()}
      className="group/resize absolute -right-1.5 top-0 bottom-0 z-10 w-3 cursor-col-resize"
    >
      <span
        className={`mx-auto block h-full transition-colors ${
          isResizing
            ? "w-0.5 bg-hypertasks-purple"
            // bg-white-black, not bg-border-labelComponent: that token is defined under
            // borderColor only, so `bg-` never emitted a background and the separator was
            // invisible at every opacity (HTPR-5050).
            : "w-px bg-white-black opacity-20 group-hover/header:opacity-40 group-hover/resize:opacity-0"
        }`}
      />
      {/* Excel's grip (HTPR-5050): the resting separator says "there is an edge here",
          this double ridge under the pointer says "and you can drag it". */}
      {!isResizing && (
        <span className="pointer-events-none absolute inset-0 hidden items-center justify-center gap-[2px] group-hover/resize:flex">
          <span className="block h-3.5 w-[1.5px] rounded-full bg-white-black" />
          <span className="block h-3.5 w-[1.5px] rounded-full bg-white-black" />
        </span>
      )}
    </span>
  );
};

const TableView = ({ filteredSections, _sections, _currentProject, handleBoardChange }: TableViewProps) => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { navigateToTask } = useHypertasksNavigate();
  const { toggleCreateTaskGlobally } = useHypertasksRecoilStates();
  const { updateActiveItemAndItemInView } = useProjectQuery();
  const { removeFromListWithStatus } = UpdateKanban();
  const [showCommands, setShowCommands] = useRecoilState(showCommandsAtom);
  const persistedActiveItem = useRecoilValue(activeItemAtom);
  const showArchivedOnBoard = useShowArchivedOnBoard(_currentProject);
  const isApple = useDeviceContext();
  const setTasksPlayList = useSetRecoilState(tasksPlayListAtom);
  const [storedVisibleColumns, setStoredVisibleColumns] = useRecoilState(tableVisibleColumnsAtom);
  const [timeColumnSeededBoards, setTimeColumnSeededBoards] = useRecoilState(
    tableTimeColumnSeededBoardsAtom,
  );
  const [columnWidths, setColumnWidths] = useRecoilState(tableColumnWidthsAtom);
  const { timeTotals } = useBoardRunningTimers(_currentProject?.id ?? null);
  const hasActiveBoardTimer = useMemo(
    () =>
      [...timeTotals.values()].some((total) =>
        total.runningTimers.some((timer) => timer.pausedAt === null),
      ),
    [timeTotals],
  );
  const timeNow = useTimerNow(
    Boolean(_currentProject?.showTimeTotals && hasActiveBoardTimer),
  );
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const draggedTaskRef = useRef<TableRowDragData | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<number | null>(null);
  const { mutate: moveTaskToSection } = useMoveTaskToSection();
  // Reorder drop indicator (HTPR-4993): which column the dragged header is
  // currently hovering, and which edge of it the dragged column would land on.
  const [dragOverColumn, setDragOverColumn] = useState<{ column: string; side: "left" | "right" } | null>(null);
  // Full-height resize guide (HTPR-4991): which column is being dragged and the
  // live pointer x, relative to tableWrapperRef, so the overlay line below can
  // track it for the whole table height instead of just the header cell.
  const [resizeGuide, setResizeGuide] = useState<{ column: string; left: number } | null>(null);
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  // Excel model (HTPR-4993): title's header cell, so any resize drag (title's own
  // or another column's) can measure title's current rendered width to freeze it.
  const titleHeaderRef = useRef<HTMLDivElement>(null);
  const { data: customFields = [] } = useQuery<CustomField[]>({
    queryKey: ["customFields", _currentProject?.id],
    enabled: Boolean(_currentProject?.id),
    queryFn: async () => (await axios.get(`/api/customFields?projectId=${_currentProject!.id}`)).data,
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expanded, setExpanded] = useState<Set<string | number>>(new Set());
  const [sortState, setSortState] = useState<SortState>(() => resolveSortState(_currentProject));
  const { setTableSortViewAndReturn, changeBoardLayout } = useKanbanViews(_currentProject);
  const didRestore = useRef(false);
  const timerToggling = useRef(false);
  // View switch (or unsaved-view create/delete) changes which saved sort applies;
  // re-derive local state from the new active view rather than keeping the old one.
  const activeSortViewId =
    _currentProject?.project_view?.user_project_views?.[0]?.unsavedView?.id ??
    _currentProject?.project_view?.user_project_views?.[0]?.appliedView?.id ??
    _currentProject?.project_view?.default_view?.id;
  useEffect(() => {
    setSortState(resolveSortState(_currentProject));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSortViewId, _currentProject?.showTimeTotals]);
  const sections = useMemo(() => {
    // An active filter may intentionally produce zero visible sections. Only
    // fall back when no filtered value was supplied, not when it is empty.
    const base = filteredSections ?? _sections ?? [];
    if (!_currentProject) return base;
    // Reuse the same empty-sections setting the kanban board applies (useHandleKeyDownOperations),
    // recomputed here so a live toggle of the setting reflects immediately, not just after refetch.
    const emptyFiltered = getFilteredEmptySections(base, _currentProject);
    return emptyFiltered.map((section) => ({
      ...section,
      // returnSortedItems sorts in place; copy so frozen Recoil/React state isn't mutated
      items: returnSortedItems([...(section.items || [])], _currentProject),
    }));
  }, [filteredSections, _sections, _currentProject]);
  // Drag is only ever allowed between real sections of a real board. The
  // _currentProject gate is what keeps /my-tasks out: it renders this table
  // with _currentProject={null} and groups by boardId, so a "section" there is
  // a board and moving into it would target the wrong thing. The ids come from
  // the rendered sections rather than _currentProject.sections so the feature
  // does not depend on that relation being hydrated on the atom.
  const currentProjectSectionIds = useMemo(
    () =>
      new Set(
        _currentProject
          ? sections.flatMap((section) => {
              const sectionId = tableSectionNumber(section);
              return typeof sectionId === "number" ? [sectionId] : [];
            })
          : []
      ),
    [_currentProject, sections]
  );
  // Section title lookup + board-position order for the 'status' column
  const sectionTitleBySid = useMemo(
    () => new Map(sections.map((section) => [tableSectionKey(section) as string | number, section.section_title])),
    [sections]
  );
  const sectionOrderBySid = useMemo(
    () => new Map(sections.map((section, index) => [tableSectionKey(section) as string | number, index])),
    [sections]
  );
  const customFieldBySortColumn = useMemo(
    () => new Map<SortColumn, CustomField>(customFields.map((field) => [customFieldSortColumn(field.id), field])),
    [customFields]
  );
  // A handful of callbacks below read this without listing it as a dependency
  // (it's cheap to recompute and rarely changes, so keeping it out of their
  // deps arrays avoids reflowing those hooks' existing dependency lists).
  const customFieldBySortColumnRef = useRef(customFieldBySortColumn);
  customFieldBySortColumnRef.current = customFieldBySortColumn;
  const customFieldById = useMemo(() => new Map(customFields.map((field) => [field.id, field])), [customFields]);
  // Resolves a stored column key (built-in or 'customField:<id>') to its render
  // spec. Number-type custom fields right-align like "updated" does, so a
  // value doesn't visually run into whatever column sits to its right
  // (HTPR-3805: an appended, unaligned custom column read as glued to Updated).
  const toTableColumn = useCallback(
    (key: string): TableColumn | undefined => {
      if (key === "time" && !_currentProject?.showTimeTotals) return undefined;
      if (isCustomFieldColumnKey(key)) {
        const field = customFieldById.get(customFieldIdFromColumnKey(key));
        if (!field) return undefined; // stored id for a field that's since been deleted
        if (field.showInTable === false) return undefined; // hidden board-wide via manage-custom-fields
        return {
          key: customFieldSortColumn(field.id),
          label: field.name,
          width: "110px",
          className: field.type === "Number" ? "text-right" : undefined,
        };
      }
      return tableColumnByKey.get(key as StaticSortColumn);
    },
    [customFieldById, _currentProject?.showTimeTotals]
  );
  // Custom fields, unlike the fixed built-in columns, are created at runtime and
  // need seeding into the stored order once (like DEFAULT_TABLE_COLUMNS seeds the
  // built-ins) so they show up by default. After that one seed, a field's
  // presence/absence is the user's own toggle choice via TableColumnsPicker,
  // same as any built-in column.
  useEffect(() => {
    if (!customFields.length) return;
    // Fields hidden board-wide (showInTable: false) never get seeded as a
    // visible column — same rule toTableColumn enforces at render time.
    const customFieldKeys = customFields
      .filter((field) => field.showInTable !== false)
      .map((field) => customFieldColumnKey(field.id));
    setStoredVisibleColumns((current) => {
      const seeded = seedMissingCustomFieldColumns(normalizeTableVisibleColumns(current), customFieldKeys);
      return seeded.length === current.length ? current : seeded;
    });
  }, [customFields, setStoredVisibleColumns]);
  useEffect(() => {
    const projectId = _currentProject?.id;
    if (
      !projectId ||
      !_currentProject.showTimeTotals ||
      timeColumnSeededBoards.includes(projectId)
    ) {
      return;
    }
    setStoredVisibleColumns((current) => {
      const normalized = normalizeTableVisibleColumns(current);
      return normalized.includes("time") ? current : [...normalized, "time"];
    });
    setTimeColumnSeededBoards((current) =>
      current.includes(projectId) ? current : [...current, projectId],
    );
  }, [
    _currentProject?.id,
    _currentProject?.showTimeTotals,
    setStoredVisibleColumns,
    setTimeColumnSeededBoards,
    timeColumnSeededBoards,
  ]);
  const visibleColumns = useMemo(() => {
    const normalized = normalizeTableVisibleColumns(storedVisibleColumns);
    // While sorted, 'status' shows regardless of the picker so the sorted-by
    // column is always visible; it disappears again once the sort clears.
    const keys = sortState.length > 0 && !normalized.includes("status")
      ? [normalized[0], normalized[1], "status", ...normalized.slice(2)]
      : normalized;
    return keys.map(toTableColumn).filter((column): column is TableColumn => Boolean(column));
  }, [storedVisibleColumns, sortState, toTableColumn]);
  // A drag-resized column (feature 3) overrides its default base width; that
  // override becomes the column's minimum, same as the unresized default did.
  const getColumnWidth = useCallback(
    (column: TableColumn) => columnWidths[column.key] ?? baseColumnWidthPx(column.width),
    [columnWidths]
  );
  // HTPR-4643: Excel frozen panes. Ticket and Title keep the row's identity on
  // screen while the data columns slide underneath, so a wide table never
  // scrolls away the one thing that says which row you are reading.
  //
  // Offsets are computed, not hardcoded: Ticket sits flush left, Title starts
  // after Ticket's CURRENT width plus the grid's 8px gutter, so a resized
  // Ticket column moves Title with it.
  const frozenColumnOffset = useCallback(
    (key: string): number | undefined => {
      if (key === "ticket") return 0;
      if (key !== "title") return undefined;
      const ticket = visibleColumns.find((column) => column.key === "ticket");
      if (!ticket) return 0;
      return getColumnWidth(ticket) + 8;
    },
    [visibleColumns, getColumnWidth]
  );
  const setColumnWidth = useCallback(
    (key: string, width: number) => {
      const clamped = Math.max(MIN_COLUMN_WIDTH_PX, Math.round(width));
      setColumnWidths((current) => (current[key] === clamped ? current : { ...current, [key]: clamped }));
    },
    [setColumnWidths]
  );
  // Excel model (HTPR-4993): called at the start of every resize drag. If title
  // still has no stored override (still auto-flexing), measure its real rendered
  // width and freeze it via setColumnWidth — after this every track is fixed px,
  // so the column actually being dragged moves 1:1 with the pointer instead of
  // title silently absorbing the delta. No-op (returns undefined) once frozen.
  const freezeTitleWidth = useCallback((): number | undefined => {
    if (columnWidths.title !== undefined) return undefined;
    const measured = titleHeaderRef.current?.getBoundingClientRect().width;
    if (!measured) return undefined;
    setColumnWidth("title", measured);
    return measured;
  }, [columnWidths.title, setColumnWidth]);
  // Excel model (HTPR-4993): title flexes to fill leftover width (minmax(...,1fr))
  // ONLY until it has a stored width override — the first resize anywhere freezes
  // it (see ColumnResizeHandle's onPointerDown), after which it's a fixed track
  // like every other column and the whole table's width becomes the sum of its
  // columns (horizontal scroll takes over via tableMinWidth below).
  const gridTemplateColumns = useMemo(
    () =>
      visibleColumns
        .map((column) =>
          column.key === "title" && columnWidths.title === undefined
            ? `minmax(${getColumnWidth(column)}px,1fr)`
            : `${getColumnWidth(column)}px`
        )
        .join(" "),
    [visibleColumns, getColumnWidth, columnWidths]
  );
  // The grid tracks are fixed/min px, so the rows only paint as wide as their
  // box. Without a min-width matching the columns, the section cards stop at
  // the viewport edge and everything scrolled past it is blank. gap 8px per
  // gutter + 40px row padding.
  const tableMinWidth = useMemo(
    () => visibleColumns.reduce((total, column) => total + getColumnWidth(column), 0) + Math.max(visibleColumns.length - 1, 0) * 8 + 40,
    [visibleColumns, getColumnWidth]
  );
  // Reorders storedVisibleColumns in place when a header cell is dropped on
  // another (feature 2) — the SAME atom the "Configure table columns" picker
  // reads/writes, so drag-reordering the header and the picker stay in sync.
  // Locked columns (ticket/title) can't move; normalizeTableVisibleColumns
  // would just snap them back to the front anyway.
  const reorderColumn = useCallback(
    (fromKey: string, toKey: string) => {
      if (fromKey === toKey || LOCKED_TABLE_COLUMNS.has(fromKey) || LOCKED_TABLE_COLUMNS.has(toKey)) return;
      setStoredVisibleColumns((current) => {
        const normalized = normalizeTableVisibleColumns(current);
        const from = normalized.indexOf(fromKey);
        const to = normalized.indexOf(toKey);
        if (from < 0 || to < 0) return current;
        const next = [...normalized];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    [setStoredVisibleColumns]
  );
  // The 'status' column can appear in visibleColumns while sorted without being
  // in storedVisibleColumns (forced-visible injection above) — only columns
  // actually in the stored order are valid drag sources/targets.
  const normalizedColumnOrder = useMemo(() => normalizeTableVisibleColumns(storedVisibleColumns), [storedVisibleColumns]);
  const storedColumnKeys = useMemo(() => new Set(normalizedColumnOrder), [normalizedColumnOrder]);

  const rows = useMemo(() => {
    if (sortState.length > 0) {
      // sectionId and sid share a numeric namespace only when there's a current
      // project (real sections); on /my-tasks, sid is the boardId (see
      // myTasksGrouping.ts), so sectionOrder would compare unrelated ids (HTPR-4887).
      const comparators = sortState.map(({ column, direction }, index) =>
        getSortComparator(
          column,
          direction,
          customFieldBySortColumnRef.current,
          _currentProject ? sectionOrderBySid : undefined,
          index === sortState.length - 1,
          timeTotals,
          timeNow,
        )
      );
      const sortTasks = (tasks: ITask[]) =>
        [...tasks].sort((a, b) => {
          for (const comparator of comparators) {
            const result = comparator(a, b);
            if (result !== 0) return result;
          }
          return 0;
        });

      // Flat sort only when there's one project: on /my-tasks the board
      // grouping IS the point, so a sort must reorder within each board's
      // section rather than flattening it away (HTPR-4887).
      if (_currentProject) {
        const allTasks = sections.flatMap((section) => section.items || []);
        return sortTasks(allTasks).map((task) => ({ type: "task" as const, task, sid: task.sectionId ?? "flat" }));
      }

      const next: Row[] = [];
      sections.forEach((section, index) => {
        const sid = tableSectionKey(section) ?? `i${index}`;
        const items = sortTasks(section.items || []);
        const shown = expanded.has(sid) ? items : items.slice(0, SECTION_CAP);
        shown.forEach((task) => next.push({ type: "task", task, sid }));
        if (items.length > shown.length)
          next.push({ type: "more", sid, hidden: items.length - shown.length });
      });
      return next;
    }

    const next: Row[] = [];
    sections.forEach((section, index) => {
      const sid = tableSectionKey(section) ?? `i${index}`;
      const items = section.items || [];
      const shown = expanded.has(sid) ? items : items.slice(0, SECTION_CAP);
      shown.forEach((task) => next.push({ type: "task", task, sid }));
      if (items.length > shown.length)
        next.push({ type: "more", sid, hidden: items.length - shown.length });
    });
    return next;
  }, [sections, expanded, sortState, sectionOrderBySid, _currentProject, timeNow, timeTotals]);

  // HTPR-4876: table view rendered <HypertasksCommands /> with no context, so
  // the palette fell back to "Others" and every Task- or Kanban-gated command
  // vanished: sort board, board time tracking, filter match mode. Table view is
  // the same board with the same filters and views, so it gets the same
  // context the board builds in Homepage's createContextOptionsForHTC.
  const buildCommandContext = useCallback((): IAllCommands => {
    const currentTask = persistedActiveItem
      ? rows
          .filter(isTaskRow)
          .map((row) => row.task)
          .find((task) => task.id === persistedActiveItem)
      : undefined;

    const taskProject =
      currentTask?.project ??
      (currentTask?.projectId === _currentProject?.id ? _currentProject : undefined);

    return {
      // No current project means /my-tasks, which is not a board: claiming
      // Kanban there would advertise sort-board and friends with nothing to
      // act on. Keep the old fallback for that surface.
      context: currentTask ? "Task" : _currentProject ? "Kanban" : "Others",
      task: currentTask
        ? {
            taskId: currentTask.id,
            projectId: currentTask.projectId,
            sectionId: currentTask.sectionId ?? null,
          }
        : undefined,
      showArchivedOnBoard,
      taskOptions: currentTask
        ? {
            isApple,
            isArchived: currentTask.status === "Archive",
            hasNotifications: !!(
              currentTask._count?.notifications &&
              currentTask._count.notifications > 0
            ),
            isKanban: true,
            hasSubtasks: !!currentTask.subTasks?.length,
            hasParent: !!currentTask.parentTaskId,
            isStarred: !!currentTask.savedContent?.length,
            timeTrackingEnabled: !!taskProject?.timeTrackingEnabled,
          }
        : undefined,
      commentOptions: undefined,
    };
  }, [_currentProject, isApple, persistedActiveItem, rows, showArchivedOnBoard]);


  const scrollToRow = useCallback((row: Row) => {
    const id = isTaskRow(row) ? `inbox-${row.task.id}` : `table-more-${row.sid}`;
    document.getElementById(id)?.scrollIntoView({ block: "nearest" });
  }, []);

  const focusTo = useCallback(
    (index: number) => {
      const nextIndex = Math.max(0, Math.min(index, rows.length - 1));
      const row = rows[nextIndex];
      if (!row) return;
      setSelectedIndex(nextIndex);
      if (isTaskRow(row)) updateActiveItemAndItemInView(row.task);
      scrollToRow(row);
    },
    [rows, scrollToRow, updateActiveItemAndItemInView]
  );

  const expandSection = useCallback((sid: string | number) => {
    setExpanded((prev) => new Set(prev).add(sid));
  }, []);

  // Multi-level UI (shift-click adds tie-break columns, up to MAX_SORT_LEVELS), but
  // only the primary level persists to the view (table_sort_column/_direction are
  // single-value DB columns, unlike kanban's board_sorting_stack) — see resolveSortState.
  const toggleSort = useCallback(
    (column: SortColumn, shiftKey: boolean) => {
      const initial = initialDirection(column, customFieldBySortColumn);
      const existingIndex = sortState.findIndex((level) => level.column === column);
      let next: SortState;
      if (shiftKey) {
        if (existingIndex >= 0) {
          next = sortState.map((level, index) =>
            index === existingIndex
              ? { ...level, direction: level.direction === "asc" ? "desc" : "asc" }
              : level
          );
        } else if (sortState.length === MAX_SORT_LEVELS) {
          next = sortState;
        } else {
          next = [...sortState, { column, direction: initial }];
        }
      } else if (sortState[0]?.column !== column) {
        next = [{ column, direction: initial }];
      } else if (sortState[0].direction === initial) {
        next = [{ column, direction: initial === "asc" ? "desc" : "asc" }];
      } else {
        next = [];
      }
      setSortState(next);
      if (_currentProject) setTableSortViewAndReturn(_currentProject, next[0] ?? null);
    },
    [sortState, _currentProject, setTableSortViewAndReturn, customFieldBySortColumn]
  );

  const getTicketText = useCallback(
    (task: ITask) => {
      const prefix = _currentProject?.uniqueIdentifier || task.ticketNumber?.split("-")[0];
      return prefix ? `${prefix.toUpperCase()}-${task.uniqueIndex}` : `#${task.uniqueIndex}`;
    },
    [_currentProject?.uniqueIdentifier]
  );

  const openTask = useCallback(
    async (task: ITask, index: number) => {
      setSelectedIndex(index);
      updateActiveItemAndItemInView(task);
      setTasksPlayList(rows.filter(isTaskRow).map(({ task }) => ({ projectId: task.projectId, uniqueIndex: task.uniqueIndex })));
      navigateToTask(task.projectId, task.uniqueIndex);
    },
    [navigateToTask, rows, setTasksPlayList, updateActiveItemAndItemInView]
  );
  const handleMouseEnter = useCallback((index: number) => setSelectedIndex(index), []);
  const handleMouseLeave = useCallback(() => {}, []);

  const clearTaskDrag = useCallback(() => {
    draggedTaskRef.current = null;
    setDragOverSectionId(null);
  }, []);

  const handleSectionDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, destinationSectionId: number) => {
      if (!canDropTableRow(draggedTaskRef.current, destinationSectionId, currentProjectSectionIds)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDragOverSectionId(destinationSectionId);
    },
    [currentProjectSectionIds]
  );

  const handleSectionDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, destinationSectionId: number, destinationSectionTitle: string) => {
      event.preventDefault();
      const draggedTask =
        draggedTaskRef.current ?? parseTableRowDragData(event.dataTransfer.getData("text/plain"));
      clearTaskDrag();
      if (!canDropTableRow(draggedTask, destinationSectionId, currentProjectSectionIds)) return;
      const task = rows.find((row) => isTaskRow(row) && row.task.id === draggedTask!.taskId);
      if (!task || !isTaskRow(task)) return;

      moveTaskToSection({
        projectId: task.task.projectId,
        taskId: task.task.id,
        ticketNumber: task.task.ticketNumber,
        sourceSectionId: draggedTask!.sourceSectionId,
        destinationSectionId,
        destinationSectionTitle,
      });
    },
    [clearTaskDrag, currentProjectSectionIds, moveTaskToSection, rows]
  );

  const toggleSelectedTaskTimer = useCallback(async (taskId: number) => {
    if (timerToggling.current) return;
    timerToggling.current = true;
    try {
      await toggleTaskTimer(taskId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time", "task", taskId] }),
        queryClient.invalidateQueries({ queryKey: ["time", "entries", taskId] }),
        queryClient.invalidateQueries({ queryKey: ["time", "running"] }),
        queryClient.invalidateQueries({ queryKey: ["time", "running-board"] }),
        queryClient.invalidateQueries({ queryKey: ["time", "report"] }),
      ]);
    } catch (error: any) {
      toast.error(error?.message ?? "Unable to update timer");
    } finally {
      timerToggling.current = false;
    }
  }, [queryClient]);

  const archiveTaskFromTable = useCallback(async (task: ITask) => {
    if (_currentProject) {
      await removeFromListWithStatus(
        task.sectionId,
        _currentProject.id,
        task.id,
        "Archive"
      );
      return;
    }

    try {
      await globalAPIHandlers.archiveTask(task.id, "Archive");
      router.refresh();
      toast("Task archived");
    } catch {
      toast.error("Unable to archive task");
    }
  }, [_currentProject, removeFromListWithStatus, router]);

  useEffect(() => {
    if (didRestore.current || !rows.length) return;
    didRestore.current = true;
    const restored = rows.findIndex((row) => isTaskRow(row) && row.task.id === persistedActiveItem);
    focusTo(restored >= 0 ? restored : 0);
  }, [focusTo, persistedActiveItem, rows]);

  useEffect(() => {
    if (!rows.length) {
      if (selectedIndex !== 0) setSelectedIndex(0);
      return;
    }
    if (selectedIndex > rows.length - 1) focusTo(rows.length - 1);
  }, [focusTo, rows.length, selectedIndex]);

  const createTaskInCurrentTableContext = useCallback(() => {
    createTaskFromTableSelection({
      hasCurrentProject: Boolean(_currentProject),
      selectedRow: rows[selectedIndex],
      sections,
      toggleCreateTaskGlobally,
    });
  }, [
    _currentProject,
    rows,
    sections,
    selectedIndex,
    toggleCreateTaskGlobally,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowCommands((prev) => ({ ...prev, show: !prev.show }));
        return;
      }
      // LandingPage renders HomePage and TableView as mutually exclusive siblings.
      // Check this before the modal/input guard, matching the board layout's
      // truly global favorite shortcut while the table layout is active.
      if (
        isFavoriteBoardShortcut(e, isApple) &&
        handleBoardChange
      ) {
        e.preventDefault();
        handleBoardChange(Number(e.code.replace("Digit", "")), _sections);
        return;
      }
      if (returnIfModalOrInputActive() || showCommands.show) return;
      // [ctrl/cmd]+[e] archives the selected task. This component also powers
      // My Tasks, so archiveTaskFromTable handles both board cache updates and
      // the cross-board server-data refresh used there.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        const row = rows[selectedIndex];
        if (!row || !isTaskRow(row)) return;
        e.preventDefault();
        if (!shouldRunArchiveShortcut(e)) return;
        void archiveTaskFromTable(row.task);
        return;
      }
      // [c] creates a task; /project is excluded from the global handler because
      // the Kanban surface owns it there, so the table surface must own it too
      if (_currentProject && e.key === "c" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        createTaskInCurrentTableContext();
        return;
      }
      if (
        e.key === "w" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey &&
        _currentProject?.timeTrackingEnabled
      ) {
        const row = rows[selectedIndex];
        if (!row || !isTaskRow(row) || timerToggling.current) return;
        e.preventDefault();
        void toggleSelectedTaskTimer(row.task.id);
        return;
      }
      if (!rows.length) return;
      if (_currentProject && e.keyCode === 84 && e.shiftKey) {
        e.preventDefault();
        changeBoardLayout("board");
        return;
      }
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        focusTo(selectedIndex + 1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        focusTo(selectedIndex - 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const row = rows[selectedIndex];
        if (row && isTaskRow(row)) openTask(row.task, selectedIndex);
        else if (row?.type === "more") expandSection(row.sid);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [_currentProject, _sections, archiveTaskFromTable, changeBoardLayout, createTaskInCurrentTableContext, expandSection, focusTo, handleBoardChange, openTask, rows, selectedIndex, setShowCommands, showCommands.show, toggleSelectedTaskTimer]);

  const renderTaskRow = (task: ITask, flatIndex: number) => {
    const selected = selectedIndex === flatIndex;
    const stickyBackground = selected
      ? "md:bg-active-elementBg"
      : dragOverSectionId === task.sectionId
        ? "md:bg-hover-active"
        : "md:bg-containerBackground";
    const dragData = getTableRowDragData(
      task.id,
      task.sectionId,
      currentProjectSectionIds,
      sortState.length > 0
    );
    const openCurrentTask = () => openTask(task, flatIndex);
    const stalenessTooltip = `${taskInColumnDays(task) ?? 0}d in column · ${taskNoCommentDays(task) ?? 0}d since last comment · ${taskOnBoardDays(task) ?? 0}d on board`;

    const renderCell = (column: SortColumn) => {
      if (isCustomFieldSortColumn(column)) {
        const field = customFieldBySortColumn.get(column);
        const customFieldValue = getCustomFieldValue(task, customFieldIdFromSortColumn(column));
        return (
          <span key={column} className={`min-w-0 truncate text-text-light-gray ${field?.type === "Number" ? "block text-right" : ""}`}>
            {customFieldValue?.value ?? ""}
          </span>
        );
      }
      switch (column) {
        case "ticket":
          return (
            <span
              key="ticket"
              // Frozen on desktop only. Mobile scrolls every column as one row.
              style={{ left: frozenColumnOffset("ticket") }}
              className={`md:sticky md:z-[1] font-bold text-icon-dark-gray whitespace-nowrap ${stickyBackground}`}
            >
              {getTicketText(task)}
            </span>
          );
        case "title":
          return (
            <span
              key="title"
              style={{ left: frozenColumnOffset("title") }}
              className={`md:sticky md:z-[1] flex items-center gap-1 overflow-hidden font-medium text-white-black whitespace-nowrap min-w-0 ${stickyBackground}`}
            >
              <span className="truncate">{task.title ?? ""}</span>
              {task.blockingTasks?.map((blockingTask) => (
                <BlockerTaskChip key={blockingTask.id} task={blockingTask} />
              ))}
            </span>
          );
        case "status":
          return (
            <span key="status" className="min-w-0 flex items-center text-[11px] text-text-light-gray truncate">
              {_currentProject
                ? sectionTitleBySid.get(task.sectionId ?? "") ?? task.section
                : task.section}
            </span>
          );
        case "assignee":
          return (
            <span key="assignee" className="min-w-0 flex items-center">{renderAssigneeAvatars(task)}</span>
          );
        case "priority":
          return (
            <span key="priority" className="min-w-0 flex items-center">
              {task.priority && (
                <PriorityLabelComponent
                  flexBasis={false}
                  fontSize={11}
                  stopPropogation={true}
                  onClick={openCurrentTask}
                  priority={task.priority}
                  className={LABEL_CLASS}
                />
              )}
            </span>
          );
        case "size":
          return (
            <span key="size" className="min-w-0 flex items-center">
              {task.estimate && (
                <EstimateLabelComponent
                  flexBasis={false}
                  fontSize={11}
                  onClick={openCurrentTask}
                  estimate={task.estimate}
                  className={LABEL_CLASS}
                />
              )}
            </span>
          );
        case "due":
          return (
            <span key="due" className="min-w-0 flex items-center">
              {task.dueDate && (
                <DueDateLabel
                  flexBasis={false}
                  fontSize={11}
                  stopPropogation={true}
                  onClick={openCurrentTask}
                  dueDate={task.dueDate}
                  className={LABEL_CLASS}
                />
              )}
            </span>
          );
        case "inColumn": {
          const days = taskInColumnDays(task);
          const level = stalenessLevel(days, {
            warnDays: _currentProject?.staleWarnDays,
            hotDays: _currentProject?.staleHotDays,
          });
          const colorClass = level === "hot" ? "text-red-600 dark:text-red-400/70" : level === "warn" ? "text-amber-600 dark:text-amber-400/70" : "text-text-light-gray";
          return (
            <span key="inColumn" title={stalenessTooltip} className="min-w-0 flex items-center">
              {days !== null && (
                <span className={`inline-flex items-center gap-1 text-[11px] ${colorClass}`}>
                  {level !== "none" && <TriangleAlert size={12} className="shrink-0" />}
                  {days}d
                </span>
              )}
            </span>
          );
        }
        case "noComment": {
          const days = taskNoCommentDays(task);
          const level = stalenessLevel(days, {
            warnDays: _currentProject?.staleWarnDays,
            hotDays: _currentProject?.staleHotDays,
          });
          const colorClass = level === "hot" ? "text-red-600 dark:text-red-400/70" : level === "warn" ? "text-amber-600 dark:text-amber-400/70" : "text-text-light-gray";
          return (
            <span key="noComment" title={stalenessTooltip} className="min-w-0 flex items-center">
              {days !== null && (
                <span className={`inline-flex items-center gap-1 text-[11px] ${colorClass}`}>
                  {level !== "none" && <TriangleAlert size={12} className="shrink-0" />}
                  {days}d
                </span>
              )}
            </span>
          );
        }
        case "onBoard": {
          const days = taskOnBoardDays(task);
          const level = stalenessLevel(days, {
            warnDays: _currentProject?.staleWarnDays,
            hotDays: _currentProject?.staleHotDays,
          });
          const colorClass = level === "hot" ? "text-red-600 dark:text-red-400/70" : level === "warn" ? "text-amber-600 dark:text-amber-400/70" : "text-text-light-gray";
          return (
            <span key="onBoard" title={stalenessTooltip} className="min-w-0 flex items-center">
              {days !== null && (
                <span className={`inline-flex items-center gap-1 text-[11px] ${colorClass}`}>
                  {level !== "none" && <TriangleAlert size={12} className="shrink-0" />}
                  {days}d
                </span>
              )}
            </span>
          );
        }
        case "time": {
          const total = displayedBoardTimeSeconds(timeTotals.get(task.id), timeNow);
          return (
            <span key="time" className="block truncate text-right text-text-light-gray" suppressHydrationWarning>
              {total > 0 ? formatElapsed(total) : ""}
            </span>
          );
        }
        case "created":
          return (
            <span key="created" className="block text-text-light-gray text-right truncate" suppressHydrationWarning>
              {task.createdAt && formatDateWithYearIfPast(task.createdAt)}
            </span>
          );
        case "updated":
          return (
            <span key="updated" className="block text-text-light-gray text-right truncate" suppressHydrationWarning>
              {task.updatedAt && formatDateDifference(task.updatedAt)}
            </span>
          );
        default:
          return null;
      }
    };

    return (
      <li
        id={`inbox-${task.id}`}
        key={`table-row-${task.id}`}
        draggable={Boolean(dragData)}
        onDragStart={(event) => {
          if (!dragData) {
            event.preventDefault();
            return;
          }
          draggedTaskRef.current = dragData;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
        }}
        onDragEnd={clearTaskDrag}
        onClick={openCurrentTask}
        onMouseEnter={() => handleMouseEnter(flatIndex)}
        onMouseLeave={handleMouseLeave}
        style={{ gridTemplateColumns }}
        className={`${TABLE_GRID_CLASS} table-view-row cursor-pointer items-center gap-2 py-[6px] md:py-[8px] px-[20px] md:px-5 rounded-md md:border-l-4 text-meta md:text-dense ${
          selected ? "md:bg-active-elementBg md:border-l-selected-item-border" : "md:border-l-transparent bg-transparent"
        }`}
      >
        {visibleColumns.map((column) => renderCell(column.key))}
      </li>
    );
  };

  let cursor = -1;
  return (
    // h-full fills the flex-sized board column (rail shell), so the horizontal
    // scrollbar sits at the bottom of the viewport instead of under the last row.
    <div className="w-full h-full min-h-0 bg-taskDetailPage overflow-x-auto overflow-y-auto table-hscroll" style={{ maxHeight: "calc(100vh - 64px)" }}>
      <div className="w-full px-4 pb-6 pt-3">
        <TableCreateTaskControl
          {...getTableCreateTaskControlProps({
            currentProject: _currentProject,
            rows,
            selectedIndex,
            sections,
            toggleCreateTaskGlobally,
          })}
        />
        <div ref={tableWrapperRef} style={{ minWidth: tableMinWidth }} className="relative">
          {resizeGuide && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-hypertasks-purple"
              style={{ left: resizeGuide.left }}
            />
          )}
          <div style={{ gridTemplateColumns }} className={`${TABLE_GRID_CLASS} table-view-header group/header sticky top-0 z-10 items-center gap-2 bg-taskDetailPage px-[20px] md:px-5 py-2 text-micro font-semibold uppercase text-text-light-gray`}>
            {visibleColumns.map((column) => {
              const sortIndex = sortState.findIndex((level) => level.column === column.key);
              const activeSort = sortState[sortIndex];
              const isActive = sortIndex >= 0;
              // Ticket/title stay put (see LOCKED_TABLE_COLUMNS); the synthetic
              // 'status' column injected while sorted also isn't draggable —
              // it isn't in storedVisibleColumns to reorder.
              const isDraggableColumn = storedColumnKeys.has(column.key) && !LOCKED_TABLE_COLUMNS.has(column.key);
              return (
                <div
                  key={column.key}
                  ref={column.key === "title" ? titleHeaderRef : undefined}
                  // The header row stays vertically sticky everywhere. Only desktop
                  // freezes the ticket and title headings horizontally.
                  style={
                    frozenColumnOffset(column.key) === undefined
                      ? undefined
                      : { left: frozenColumnOffset(column.key) }
                  }
                  className={`relative min-w-0 ${
                    frozenColumnOffset(column.key) === undefined ? "" : "md:sticky md:z-20 md:bg-taskDetailPage"
                  }`}
                >
                  {dragOverColumn?.column === column.key && (
                    <div
                      className={`pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-hypertasks-purple ${
                        dragOverColumn.side === "left" ? "left-0" : "right-0"
                      }`}
                    />
                  )}
                  <button
                    type="button"
                    draggable={isDraggableColumn}
                    onClick={(event) => toggleSort(column.key, event.shiftKey)}
                    onDragStart={(event) => {
                      setDraggedColumn(column.key);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", column.key);
                    }}
                    onDragOver={(event) => {
                      if (!isDraggableColumn || !draggedColumn || draggedColumn === column.key) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      // Insertion line lands on the side the dragged column would land: dragged
                      // currently to the right of this column (moving right-to-left) -> left edge,
                      // otherwise (moving left-to-right) -> right edge.
                      const draggedIndex = normalizedColumnOrder.indexOf(draggedColumn);
                      const targetIndex = normalizedColumnOrder.indexOf(column.key);
                      const side = draggedIndex > targetIndex ? "left" : "right";
                      setDragOverColumn((current) =>
                        current?.column === column.key && current.side === side ? current : { column: column.key, side }
                      );
                    }}
                    onDragLeave={() => setDragOverColumn((current) => (current?.column === column.key ? null : current))}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggedColumn) reorderColumn(draggedColumn, column.key);
                      setDraggedColumn(null);
                      setDragOverColumn(null);
                    }}
                    onDragEnd={() => {
                      setDraggedColumn(null);
                      setDragOverColumn(null);
                    }}
                    // The resize handle is centered on the cell edge with half of
                    // its 12px hit area inside the cell. Keep label text clear of it.
                    className={`block w-full min-w-0 pr-3 uppercase ${column.className || "text-left"} ${isActive ? "text-white-black" : "text-text-light-gray"} ${
                      isDraggableColumn ? "cursor-grab active:cursor-grabbing" : ""
                    } ${draggedColumn === column.key ? "opacity-50" : ""}`}
                  >
                    <span className={`inline-flex min-w-0 items-center ${column.className === "text-right" ? "justify-end w-full" : ""}`}>
                      <span className="truncate">{column.label}</span>
                      {isActive && <span className="ml-1 text-micro">{activeSort.direction === "asc" ? "▲" : "▼"}</span>}
                      {sortIndex > 0 && <span className="ml-0.5 align-super text-[9px] text-[#C2CFA5]">{sortIndex + 1}</span>}
                    </span>
                  </button>
                  <ColumnResizeHandle
                    column={column.key}
                    width={getColumnWidth(column)}
                    onBeforeResize={freezeTitleWidth}
                    onResize={setColumnWidth}
                    containerRef={tableWrapperRef}
                    isResizing={resizeGuide?.column === column.key}
                    onDragStateChange={(left) => setResizeGuide(left === null ? null : { column: column.key, left })}
                  />
                </div>
              );
            })}
          </div>
          {sortState.length > 0 && _currentProject ? (
            <div className="bg-containerBackground shadow-md rounded-md py-2">
              <ul className="px-0">
                {rows.filter(isTaskRow).map(({ task }, index) => renderTaskRow(task, index))}
              </ul>
            </div>
          ) : (
            <div className="flex flex-col gap-[16px]">
              {sections.map((section, sectionIndex) => {
                const sid = tableSectionKey(section) ?? `i${sectionIndex}`;
                const rawItems = section.items || [];
                // On /my-tasks a sort must reorder within each board's group rather than
                // flattening it, so pull the already-sorted rows for this sid instead of
                // recomputing from the unsorted section.items (HTPR-4887).
                const sectionRows = sortState.length > 0 ? rows.filter((row) => row.sid === sid) : null;
                const shown = sectionRows
                  ? sectionRows.filter(isTaskRow).map((row) => row.task)
                  : expanded.has(sid) ? rawItems : rawItems.slice(0, SECTION_CAP);
                const hidden = sectionRows
                  ? sectionRows.find((row) => row.type === "more")?.hidden ?? 0
                  : rawItems.length - shown.length;
                const destinationSectionId = tableSectionNumber(section) ?? null;
                return (
                  <div
                    key={sid}
                    onDragOver={(event) => {
                      if (destinationSectionId !== null) handleSectionDragOver(event, destinationSectionId);
                    }}
                    onDragLeave={(event) => {
                      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                      setDragOverSectionId((current) => current === destinationSectionId ? null : current);
                    }}
                    onDrop={(event) => {
                      if (destinationSectionId !== null) {
                        handleSectionDrop(event, destinationSectionId, section.section_title);
                      }
                    }}
                    className={`${destinationSectionId !== null && dragOverSectionId === destinationSectionId ? "bg-hover-active" : "bg-containerBackground"} shadow-md rounded-md py-2`}
                  >
                    <div className="px-[10px] pt-1">
                      <SplitTitle isSelected={true} onClick={() => {}} tab={{ idx: sectionIndex, project: section.section_title, length: rawItems.length, hasUnseen: false }} />
                    </div>
                    <ul className="px-0">
                      {shown.map((task) => {
                        cursor += 1;
                        const flatIndex = cursor;
                        return renderTaskRow(task, flatIndex);
                      })}
                      {hidden > 0 && (() => {
                        cursor += 1;
                        const flatIndex = cursor;
                        return (
                          <li
                            id={`table-more-${sid}`}
                            key={`table-more-${sid}`}
                            onClick={() => { setSelectedIndex(flatIndex); expandSection(sid); }}
                            onMouseEnter={() => setSelectedIndex(flatIndex)}
                            className={`cursor-pointer py-[8px] px-[20px] md:px-5 rounded-md md:border-l-4 text-text-light-gray text-dense ${selectedIndex===flatIndex ? "md:bg-active-elementBg md:border-l-selected-item-border" : "md:border-l-transparent"}`}
                          >
                            Show {hidden} more
                          </li>
                        );
                      })()}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {showCommands.show && (
        <Suspense fallback={null}>
          <HypertasksCommands contextOptions={buildCommandContext()} />
        </Suspense>
      )}
    </div>
  );
};

export default TableView;
