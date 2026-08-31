"use client";
import {
  IAgent,
  IEstimate,
  IPriority,
  ITask,
  ITaskLabel,
  IUser,
} from "@/models/model";
import { useRecoilValue } from "@/lib/state";
import { currentProjectAtom } from "@/store";
import TaskDraggableContainer from "../Kanban/KanbanTaskComponents/TaskDraggableContainer";
import { Draggable, DroppableProvided } from "@hello-pangea/dnd";
import { Circle, Plus, MessageCircle } from "lucide-react";
import { useMemo, useState } from "react";
import Tooltip from "@/components/Common/Tooltip";
import { calendarConfig } from "@/lib/configs/ calendar.config";
import UserAvatar from "@/components/Common/UserAvatar";
import PriorityLabelComponent from "@/components/Modals/TaskPriority/PriorityLabelComponent";
import EstimateLabelComponent from "@/components/Modals/TaskEstimate/EstimateLabelComponent";
import TaskLabelComponent from "@/components/Modals/CreateLabel/TaskLabelComponent";
import { renderAssigneeAvatars } from "@/components/PageComponents/Kanban/TableView/TableView";
import { useCalendarContext } from "@/lib/contexts/Calendar/calendar.context";

// Day view renders tasks as table rows matching the board table view
// (TableView.tsx) — same grid, header, and cell styling.
const DAY_TABLE_COLUMNS = "90px minmax(200px,1fr) 140px 64px 100px 80px";
const DAY_TABLE_LABEL_CLASS = "border-border-labelComponent text-label-component";
const isTaskBlocked = (task: ITask) =>
  task.waitingOnUserId !== null && task.waitingOnUserId !== undefined;

export function TaskCard({
  task,
  taskDay,
  index,
  active,
  handleTaskClick,
  view,
}: {
  task: ITask;
  index: number; //this for dnd context. Not the index for keys thingy
  active: boolean;
  taskDay: Date;
  handleTaskClick: (taskDay: Date, task: ITask) => void;
  view: "month" | "week";
}) {
  const currentProject = useRecoilValue(currentProjectAtom);
  const isOverdue = task.dueDate && task.dueDate < new Date() ? true : false;
  const taskSaved = (task._count?.savedContent ?? 0) > 0;
  const assignees = useMemo<(IUser | IAgent)[]>(() => {
    if (!task.assignees?.length) return [];

    // Mirror Kanban behavior: each assignee row contributes agent first, then user.
    return task.assignees
      .map((item) => {
        if (item.agent) return item.agent;
        if (item.user) return item.user;
        return null;
      })
      .filter(Boolean) as (IUser | IAgent)[];
  }, [task.assignees]);

  return (
    <Draggable
      shouldRespectForcePress={false}
      key={calendarConfig.element_ids.task_card(task.id)}
      draggableId={calendarConfig.element_ids.task_card(task.id)}
      index={index}
    >
      {(provided, snapshot) => (
        <div
          tabIndex={0}
          id={calendarConfig.element_ids.task_card(task.id)}
          className={`${calendarConfig.ui.task_card.parent_classname} ${
            view === "month" ? "relative group" : ""
          }`}
          onClick={(e: any) => {
            e.preventDefault();
            e.stopPropagation();
            handleTaskClick(taskDay, task);
          }}
        >
          {view === "month" && (
            <Tooltip
              bottom={-40}
              left={0}
              text={task.title}
              keyCombination={[]}
            />
          )}
          <TaskDraggableContainer
            provided={provided}
            snapshot={snapshot}
            taskHref={``}
            _currentProject={currentProject!}
            openDetail={() => {}}
            active={active}
            blocked={isTaskBlocked(task)}
            linkClassName={view === "month" ? "gap-0" : ""}
          >
            <div className={`flex gap-1 flex-wrap basis-full items-center`}>
              <span className="flex flex-grow gap-1 items-center relative min-w-0">
                {taskSaved && (
                  <Circle size={7}
                    className={`fill-current ${calendarConfig.ui.task_card.saved_classname}`}
                   strokeWidth={1.75} fill="currentColor"/>
                )}
                {isOverdue && (
                  <Circle size={7}
                    className={`fill-current ${calendarConfig.ui.task_card.overdue_classname(
                      taskSaved
                    )}`}
                   strokeWidth={1.75} fill="currentColor"/>
                )}
                <p
                  className={calendarConfig.ui.task_card.ticket_number_classname(
                    view
                  )}
                >{`${task.ticketNumber}`}</p>
              </span>
              {task._count?.comments && task._count?.comments > 0 ? (
                <div
                  className="bg-inherit border-[0px]  h-labelComponent text-meta
                border-border-labelComponent rounded-sm flex gap-1 items-center p-1"
                >
                  <MessageCircle size={14} className="text-label-component"  strokeWidth={1.75}/>
                  <span className="text-label-component text-micro">
                    {task._count?.comments}
                  </span>
                </div>
              ) : (
                <></>
              )}
              {assignees && assignees.length > 0 && (
                <div className="flex items-center ">
                  {assignees.slice(0, 5).map((assignee, index) => (
                    <UserAvatar
                      key={index}
                      alt={assignee.displayName ?? "Assignee"}
                      className={`${
                        index === 0 ? "ml-[0px] " : "ml-[-8px]"
                      } ring-1 ring-[var(--bg-containerBackground)]`}
                      name={assignee.displayName}
                      photoURL={assignee.photoURL}
                      size={16}
                      title={assignee.displayName}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-1">
              <p
                className={calendarConfig.ui.task_card.task_title_classname(
                  view
                )}
              >
                {task.title}
              </p>
            </div>
            <TaskTagsRow
              estimate={task.estimate ?? undefined}
              priority={task.priority ?? undefined}
              taskLabels={task.taskLabels ?? []}
              view={view}
            />
          </TaskDraggableContainer>
        </div>
      )}
    </Draggable>
  );
}

const TaskTagsRow = ({
  priority,
  estimate,
  taskLabels = [],
  view,
}: {
  priority: IPriority | undefined;
  estimate: IEstimate | undefined;
  taskLabels: ITaskLabel[];
  view: "month" | "week";
}) => {
  if (!priority && !estimate && taskLabels.length === 0) return <></>;
  return (
    <div className={`basis-full flex gap-1 flex-wrap`}>
      {/* {dueDate && (
        <DueDateLabel
          stopPropogation={true}
          flexBasis={false}
          fontWeight={500}
          dueDate={dueDate}
        />
      )} */}
      {priority && (
        <PriorityLabelComponent
          stopPropogation={true}
          flexBasis={false}
          fontWeight={500}
          priority={priority}
          fontSize={view === "month" ? 10 : 12}
          className={view === "month" ? "text-micro" : "text-meta"}
        />
      )}
      {estimate && (
        <EstimateLabelComponent
          flexBasis={false}
          fontWeight={500}
          estimate={estimate}
          fontSize={view === "month" ? 10 : 12}
          className={view === "month" ? "text-micro" : "text-meta"}
        />
      )}

      {/* ===================== task labels (capped, +N overflow) ================= */}
      {(() => {
        // HTPR-4113: calendar cards drowned in label chips. The kanban and
        // inbox rows already cap at 3 with a +N chip, but the calendar defines
        // its own TaskTagsRow locally, so it never picked that up. Same cap,
        // same overflow, sized for the month/week card variants.
        const MAX_LABELS = 3;
        const labels = (taskLabels ?? []).filter((l) => l.label?.value);
        const extra = labels.length - MAX_LABELS;
        return (
          <>
            {labels.slice(0, MAX_LABELS).map((taskLabel) => (
              <TaskLabelComponent
                key={`Label-component-${taskLabel.id}`}
                stopPropogation={true}
                fontWeight={500}
                flexBasis={false}
                labelValue={taskLabel.label?.value ?? ""}
                px={view === "month" ? 4 : 6}
                fontSize={view === "month" ? 10 : 12}
                className={view === "month" ? "text-micro" : "text-meta"}
              />
            ))}
            {extra > 0 && (
              <span
                className="opacity-60"
                style={{ fontSize: view === "month" ? 10 : 12 }}
              >
                +{extra}
              </span>
            )}
          </>
        );
      })()}
    </div>
  );
};

const formatDate = (date: Date, format: string) => {
  if (format === "d") return date.getDate().toString();
  return calendarConfig.constants.day_names[date.getDay()];
};

export function DaySection({
  day,
  provided,
  currentDay,
  currentTask,
  toggleManageTasksModal,
  toggleDueDateModal,
  view,
  getTasksForDate,
  handleTaskClick,
  dayIndex,
}: {
  day: Date;
  dayIndex: number;
  provided: DroppableProvided;
  currentDay: Date;
  currentTask: number;
  view: "month" | "week" | "day";
  toggleManageTasksModal?: () => void;
  toggleDueDateModal: () => void;
  getTasksForDate: (date: Date) => ITask[];
  handleTaskClick: (taskDay: Date, task: ITask) => void;
}) {
  const [hover, setHover] = useState(false);
  const { projects, setCurrentTask } = useCalendarContext();
  const tasksForDate = getTasksForDate(day);
  const hasTasks = tasksForDate.length > 0;
  const isMonthView = view === "month";
  const showMoreTasks = isMonthView && tasksForDate.length > 2;
  const tasksToShow =
    isMonthView && tasksForDate.length > 2
      ? tasksForDate.slice(0, 2)
      : tasksForDate;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      id={calendarConfig.element_ids.day_section(day)}
      key={calendarConfig.element_ids.day_section(day)}
      className={`flex-1 flex flex-col ${
        // Day view scrolls horizontally when squeezed below the table's
        // min-width; week/month keep the original clipping behavior.
        view === "day"
          ? "h-full overflow-x-auto overflow-y-hidden"
          : view === "week"
            ? "h-full overflow-hidden"
            : "min-h-full"
      } ${calendarConfig.ui.day_section.parent_classname(
        view !== "day" &&
          currentDay.toISOString() === day.toISOString() &&
          currentTask === -1,
        hasTasks
      )}`}
    >
      <div className="flex items-center justify-between flex-shrink-0">
        {/* Day view's toolbar already names the date, so the number is hidden,
            but the row stays so mouse users keep the hover add-task control. */}
        <span
          className={`text-content font-medium text-muted-foreground mb-0.5 ${
            view === "day" ? "invisible" : ""
          }`}
        >
          {formatDate(day, "d")}
        </span>
        {hover && (
          <div className="relative group">
            <Plus
              size={14}
              className="text-muted-foreground cursor-pointer"
              onClick={(e: any) => {
                e.preventDefault();
                e.stopPropagation();
                toggleDueDateModal();
              }}
             strokeWidth={1.75}/>
            <Tooltip
              {...(calendarConfig.ui.day_section.tooltip
                .add_button as unknown as any)}
            />
          </div>
        )}
      </div>
      {view === "day" && hasTasks && (
        <div
          style={{ gridTemplateColumns: DAY_TABLE_COLUMNS }}
          className="grid min-w-[754px] flex-shrink-0 items-center gap-2 px-5 py-2 text-micro font-semibold uppercase text-text-light-gray"
        >
          <span>Ticket</span>
          <span>Title</span>
          <span>Board</span>
          <span>Assignee</span>
          <span>Priority</span>
          <span>Size</span>
        </div>
      )}
      <div
        {...provided.droppableProps}
        ref={provided.innerRef}
        className={`${
          view !== "month"
            ? "overflow-y-auto h-full max-h-inherit scrollbar-thin hover:scrollbar-thumb-gray-500 scrollbar-thumb-gray-500 scrollbar-track-kanban-column-scrollbar dark:scrollbar-thumb-[#4F5766]"
            : ""
        } ${view === "day" ? "min-w-[754px]" : "space-y-1"}`}
      >
        {view === "day"
          ? tasksToShow.map((task) => {
              // Prefer the context project: the task loader's project only
              // carries {id, title} and title is nullable; context has the
              // name slug to fall back on.
              const project =
                projects.find((item) => item.id === task.projectId) ??
                task.project;
              const selected = currentTask === task.id;
              const blocked = isTaskBlocked(task);
              let borderClass = "border-l-transparent";
              if (blocked) borderClass = "border-[hsl(0_62.8%_30.6%)]";
              else if (selected) borderClass = "border-l-selected-item-border";
              const openTask = () => handleTaskClick(day, task);
              return (
                // The row carries the task-<id> focus target the calendar's
                // keyboard navigation expects.
                <div
                  key={calendarConfig.element_ids.task_card(task.id)}
                  id={calendarConfig.element_ids.task_card(task.id)}
                  tabIndex={0}
                  onClick={openTask}
                  onMouseEnter={() => setCurrentTask(task.id)}
                  style={{ gridTemplateColumns: DAY_TABLE_COLUMNS }}
                  className={`outline-none grid cursor-pointer items-center gap-2 py-[6px] px-5 rounded-md border-l-4 text-dense ${
                    selected ? "bg-active-elementBg" : "bg-transparent"
                  } ${borderClass}`}
                >
                  <span className="font-bold text-icon-dark-gray whitespace-nowrap">
                    {/* Calendar payloads don't select the project prefix;
                        ticketNumber is server-formatted on real tasks. */}
                    {task.ticketNumber || `#${task.uniqueIndex}`}
                  </span>
                  <span className="font-medium text-white-black truncate whitespace-nowrap min-w-0">
                    {task.title ?? ""}
                  </span>
                  <span className="min-w-0 flex items-center text-[11px] text-text-light-gray truncate">
                    {project ? project.title ?? project.name : ""}
                  </span>
                  <span className="min-w-0 flex items-center">
                    {renderAssigneeAvatars(task)}
                  </span>
                  <span className="min-w-0 flex items-center">
                    {task.priority && (
                      <PriorityLabelComponent
                        flexBasis={false}
                        fontSize={11}
                        stopPropogation={true}
                        onClick={openTask}
                        priority={task.priority}
                        className={DAY_TABLE_LABEL_CLASS}
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex items-center">
                    {task.estimate && (
                      <EstimateLabelComponent
                        flexBasis={false}
                        fontSize={11}
                        onClick={openTask}
                        estimate={task.estimate}
                        className={DAY_TABLE_LABEL_CLASS}
                      />
                    )}
                  </span>
                </div>
              );
            })
          : tasksToShow.map((task) => (
              <TaskCard
                handleTaskClick={handleTaskClick}
                active={currentTask === task.id}
                task={task}
                index={dayIndex}
                key={calendarConfig.element_ids.task_card(task.id)}
                taskDay={day}
                view={view}
              />
            ))}
        {provided.placeholder}
      </div>
      {hasTasks && showMoreTasks && (
        <div
          id={calendarConfig.element_ids.more_tasks_indicator(day)}
          tabIndex={0}
          className={`outline-none rounded-[5px] md:border-none hover:bg-hoverCardBackground bg-cardBackground px-2 py-1 mt-1 cursor-pointer flex-shrink-0 ${
            currentTask === calendarConfig.constants.focus_more_indicator &&
            currentDay.toISOString() === day.toISOString()
              ? "border-white-black bg-kanban-active-cardbg hover:bg-hover-active"
              : ""
          }`}
          onClick={() => toggleManageTasksModal?.()}
        >
          <p className="text-gray-600 dark:text-gray-300 text-micro">
            {tasksForDate.length - tasksToShow.length} more
          </p>
        </div>
      )}
    </div>
  );
}
