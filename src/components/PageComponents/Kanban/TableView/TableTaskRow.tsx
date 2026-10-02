import { ITask } from "@/models/model";
import PriorityLabelComponent from "@/components/Modals/TaskPriority/PriorityLabelComponent";
import EstimateLabelComponent from "@/components/Modals/TaskEstimate/EstimateLabelComponent";
import TaskLabelComponent from "@/components/Modals/CreateLabel/TaskLabelComponent";
import DueDateLabel from "@/components/Labels/DueDateLabel";
import formatDateDifference, { formatDateWithYearIfPast } from "@/utils/generateTime";
import { stalenessLevel } from "@/lib/staleness";
import { TriangleAlert } from "lucide-react";
import { BlockerTaskChip } from "@/components/PageComponents/Kanban/KanbanTaskComponents/BlockerChip";
import { displayedBoardTimeSeconds } from "@/lib/boardTimeTotals";
import { formatElapsed } from "@/lib/timeDuration";
import { getTableRowDragData } from "./tableRowDrag";
import SelectionCheckbox from "@/components/Common/selection-checkbox";
import type { TableViewProps } from "./tableViewShared";
import type { useTableState } from "./useTableState";
import type { useTableActions } from "./useTableActions";
import type { useTableColumns } from "./useTableColumns";
import { taskInColumnDays, taskNoCommentDays, taskOnBoardDays, SortColumn, isCustomFieldSortColumn, getCustomFieldValue, customFieldIdFromSortColumn, LABEL_CLASS, renderAssigneeAvatars, TABLE_GRID_CLASS } from "./tableViewShared";

type Context = Pick<TableViewProps, "_currentProject" | "enableMyTasksBulkSelection"> &
  Pick<ReturnType<typeof useTableState>, "selectedIndex" | "dragOverSectionId" | "currentProjectSectionIds" | "sortState" | "customFieldBySortColumn" | "sectionTitleBySid" | "timeTotals" | "timeNow" | "draggedTaskRef" | "myTasksBulk"> &
  Pick<ReturnType<typeof useTableActions>, "openTask" | "getTicketText" | "clearTaskDrag" | "handleMouseEnter" | "handleMouseLeave"> &
  Pick<ReturnType<typeof useTableColumns>, "frozenColumnOffset" | "gridTemplateColumns" | "visibleColumns">;

export function createTableRowRenderer(context: Context) {
  const {
  selectedIndex, dragOverSectionId, currentProjectSectionIds, sortState, openTask,
  customFieldBySortColumn, frozenColumnOffset, getTicketText, _currentProject, sectionTitleBySid,
  timeTotals, timeNow, draggedTaskRef, clearTaskDrag, handleMouseEnter,
  handleMouseLeave, gridTemplateColumns, enableMyTasksBulkSelection, myTasksBulk, visibleColumns,
  } = context;


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
        case "board":
          return (
            <span key="board" className="min-w-0 flex items-center text-micro text-text-light-gray truncate">
              {task.project?.title ?? task.project?.name ?? ""}
            </span>
          );
        case "labels":
          return (
            <span key="labels" className="min-w-0 flex items-center gap-1 overflow-hidden">
              {task.taskLabels?.slice(0, 3).map((taskLabel) => (
                <TaskLabelComponent
                  key={`table-label-${taskLabel.id}`}
                  stopPropogation={true}
                  fontWeight={500}
                  fontSize={11}
                  onClick={openCurrentTask}
                  flexBasis={false}
                  labelValue={taskLabel.label?.value ?? ""}
                  className={LABEL_CLASS}
                />
              ))}
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
        tabIndex={-1}
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
        className={`${TABLE_GRID_CLASS} table-view-row group/selection_row cursor-pointer items-center gap-2 py-[6px] md:py-[8px] px-[20px] md:px-5 rounded-md md:border-l-4 text-meta md:text-dense outline-none ${
          selected ? "md:bg-active-elementBg md:border-l-selected-item-border" : "md:border-l-transparent bg-transparent"
        }`}
      >
        {enableMyTasksBulkSelection && myTasksBulk ? (
          <SelectionCheckbox
            id={task.id}
            isChecked={myTasksBulk.isSelected(task.id)}
            alwaysVisible={myTasksBulk.selectedCount > 0}
            groupName="selection_row"
            borderColorClass="!border-text-light-gray"
            checkmarkColorClass="text-white-black"
            onClick={(_id, event) => {
              myTasksBulk.toggleTaskSelection(task.id, Boolean(event?.shiftKey));
            }}
          />
        ) : null}
        {visibleColumns.map((column) => renderCell(column.key))}
      </li>
    );
  };
  return {
  renderTaskRow,
  };
}
