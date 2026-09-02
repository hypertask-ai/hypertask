import { DraggableProvided, DraggableStateSnapshot } from "@hello-pangea/dnd";
import React from "react";

import { IAgent, IProject, ITask, IUser } from "@/models/model";
import { TBoardSubtaskSetting } from "@/models/Views/model";
import {
  daysSince,
  formatKanbanStalenessLine,
  stalenessLevel,
} from "@/lib/staleness";
import { getActiveStalenessFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";

import CardSubTasks from "./CardSubTasks";
import FlattenedParentTask from "./FlattenedParentTask";
import TaskDraggableContainer from "./TaskDraggableContainer";
import TaskTagsRow from "./TaskTagsRow";
import type { BlockerUser } from "./BlockerChip";
import TaskTopRow from "./TaskTopRow";
import SelectionCheckbox from "@/components/Common/selection-checkbox";
import { cn } from "@/utils/undoActions/helperFuncs";

interface KanbanTaskCardProps {
  task: ITask;
  project?: IProject;
  currentSetting: TBoardSubtaskSetting;
  assignedUsers: IUser[];
  agentAssignees: IAgent[];
  blockingUser?: BlockerUser;
  active: boolean;
  selected?: boolean;
  hover: boolean;
  hasDraft: boolean;
  isArchivedOnBoard?: boolean;
  provided?: DraggableProvided;
  snapshot?: DraggableStateSnapshot;
  cardRef?: React.Ref<HTMLDivElement>;
  onFocusCapture?: React.FocusEventHandler<HTMLDivElement>;
  onBlurCapture?: React.FocusEventHandler<HTMLDivElement>;
  onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
  onTouchStart?: React.TouchEventHandler<HTMLDivElement>;
  openDetail: () => void;
  updateActiveItemAndItemInView: (task: ITask) => void;
  setShowAssignModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowEstimateModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowPriorityModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCreateLabelModal: React.Dispatch<React.SetStateAction<boolean>>;
  toggleDueDate: () => void;
  toggleDelete: () => void;
  markTaskAsDone: () => void;
  archiveNotificationCallback: () => void;
  handleStarTask: () => void;
  eHandler: () => void;
  onParentTaskClick: () => void;
  onSubtaskClick: (uniqueIndex: number) => void;
  onSelectionClick?: (
    id: number,
    event?: React.MouseEvent<HTMLButtonElement>,
  ) => void;
  selectionMode?: boolean;
}

/** The board card body without a required drag-and-drop context. */
const KanbanTaskCard = ({
  task,
  project,
  currentSetting,
  assignedUsers,
  agentAssignees,
  blockingUser,
  active,
  selected = false,
  hover,
  hasDraft,
  isArchivedOnBoard,
  provided,
  snapshot,
  cardRef,
  onFocusCapture,
  onBlurCapture,
  onMouseEnter,
  onMouseLeave,
  onTouchStart,
  openDetail,
  updateActiveItemAndItemInView,
  setShowAssignModal,
  setShowEstimateModal,
  setShowPriorityModal,
  setShowCreateLabelModal,
  toggleDueDate,
  toggleDelete,
  markTaskAsDone,
  archiveNotificationCallback,
  handleStarTask,
  eHandler,
  onParentTaskClick,
  onSubtaskClick,
  onSelectionClick,
  selectionMode = false,
}: KanbanTaskCardProps) => (
  <div
    ref={cardRef}
    tabIndex={0}
    id={`task-${task.id}`}
    className="outline-none rounded-[5px] xs:border-[1px] md:border-none xs:border-light-black-border-1"
    onFocusCapture={onFocusCapture}
    onBlurCapture={onBlurCapture}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
    onTouchStart={onTouchStart}
  >
    <TaskDraggableContainer
      provided={provided}
      snapshot={snapshot}
      selected={selected}
      selectionControl={
        onSelectionClick ? (
          <SelectionCheckbox
            id={task.id}
            isChecked={selected}
            onClick={onSelectionClick}
            alwaysVisible={selectionMode}
            groupName="kanban-selection"
            className={cn(
              "absolute left-2 top-2 z-20 bg-cardBackground",
              selected
                ? "!border-hypertasks-purple !bg-hypertasks-purple"
                : "border-light-black-border-1 hover:border-text-light-gray",
            )}
            checkmarkColorClass="text-white"
            borderColorClass="border-light-black-border-1"
          />
        ) : null
      }
      taskHref={`/detail/project-${task.projectId}/${task.uniqueIndex}`}
      _currentProject={project}
      openDetail={openDetail}
      active={active}
      blocked={
        (task.waitingOnUserId !== null && task.waitingOnUserId !== undefined) ||
        (task.blockingTasks?.length ?? 0) > 0
      }
      linkClassName={cn(
        "group-hover/kanban-selection:pl-7",
        (selectionMode || selected) && "pl-7",
      )}
      parentClassName={isArchivedOnBoard ? "opacity-50" : undefined}
    >
      <FlattenedParentTask
        parentTask={task.parentTask}
        currentSetting={currentSetting}
        onClick={onParentTaskClick}
      />
      <TaskTopRow
        task={task}
        updateActiveItemAndItemInView={updateActiveItemAndItemInView}
        setShowAssignModal={setShowAssignModal}
        eHandler={eHandler}
        _count={task.totalComments ?? task._count?.comments}
        notifications={task.notifications}
        ticketNumber={task.ticketNumber ?? ""}
        assignees={assignedUsers}
        agentAssignees={agentAssignees}
        countNotifications={task._count?.notifications}
        countSubtasks={task.subTasks?.length ?? 0}
        subTaskSetting={currentSetting}
        toggleDelete={toggleDelete}
        markTaskAsDone={markTaskAsDone}
        archiveNotificationCallback={archiveNotificationCallback}
        hover={hover}
        handleStarTask={handleStarTask}
      />
      <TaskTitle title={task.title} />
      <TaskTagsRow
        task={task}
        setShowEstimateModal={setShowEstimateModal}
        setShowPriorityModal={setShowPriorityModal}
        setShowCreateLabelModal={setShowCreateLabelModal}
        setShowAssignModal={setShowAssignModal}
        toggleDueDate={toggleDueDate}
        updateActiveItemAndItemInView={updateActiveItemAndItemInView}
        dueDate={task.dueDate}
        estimate={task.estimate!}
        priority={task.priority!}
        taskLabels={task.taskLabels}
        hasDraft={hasDraft}
        blockingUser={blockingUser}
        agents={agentAssignees}
      />
      <CardSubTasks
        subTasks={task.subTasks}
        currentSetting={currentSetting}
        onClick={onSubtaskClick}
      />
      <TaskStalenessLine
        enabled={getActiveStalenessFromProject(project)}
        project={project}
        task={task}
      />
    </TaskDraggableContainer>
  </div>
);

const TaskStalenessLine = ({
  enabled,
  project,
  task,
}: {
  enabled: boolean;
  project?: IProject;
  task: ITask;
}) => {
  if (!enabled) return null;

  const columnDays = daysSince(task.sectionChangedAt ?? task.createdAt);
  const commentDays = daysSince(task.lastCommentAt ?? task.createdAt);
  const boardDays = daysSince(task.createdAt);
  const thresholds = {
    warnDays: project?.staleWarnDays,
    hotDays: project?.staleHotDays,
  };
  const columnLevel = stalenessLevel(columnDays, thresholds);
  const commentLevel = stalenessLevel(commentDays, thresholds);
  const level =
    columnLevel === "hot" || commentLevel === "hot"
      ? "hot"
      : columnLevel === "warn" || commentLevel === "warn"
        ? "warn"
        : "none";

  const ageLine = formatKanbanStalenessLine({
    daysOnBoard: boardDays,
    daysInColumn: columnDays,
    daysSinceLastComment: commentDays,
    level,
    commentLevel,
  });

  if (!ageLine) return null;

  return (
    <p
      className={`basis-full text-micro leading-none ${
        level === "hot"
          ? "text-red-600 dark:text-red-400/70"
          : "text-amber-600 dark:text-amber-400/70"
      }`}
    >
      {ageLine}
    </p>
  );
};

const TaskTitle = ({ title }: { title: string }) => (
  <div className="flex flex-1 text-white-black">
    <p className="break-all whitespace-pre-line text-left text-dense">
      {title}
    </p>
  </div>
);

export default KanbanTaskCard;
