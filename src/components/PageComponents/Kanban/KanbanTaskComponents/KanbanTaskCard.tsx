import { HTPR_8629_KANBAN_HOVER_LAYOUT_FLAG } from "@/lib/flags/definitions/htpr-8629-kanban-hover-layout";
import { HTPR_7975_COLUMN_WORK_LIMITS_FLAG } from "@/lib/flags/definitions/htpr-7975-column-work-limits";
import { HTPR_8255_KANBAN_CLEANUP_FLAG } from "@/lib/flags/definitions/htpr-8255-kanban-cleanup";
import { HTPR_8927_BOARD_CARD_OVERFLOW_FLAG } from "@/lib/flags/definitions/htpr-8927-board-card-overflow";
import { HTPR_8960_BORDER_ONLY_SELECT_FLAG } from "@/lib/flags/definitions/htpr-8960-border-only-select";
import { HTPR_8970_CALM_CARDS_FLAG } from "@/lib/flags/definitions/htpr-8970-calm-cards";
import { HTPR_8971_CARD_SETTINGS_FLAG } from "@/lib/flags/definitions/htpr-8971-card-settings";
import { HTPR_9026_CARD_PEOPLE_FLAG } from "@/lib/flags/definitions/htpr-9026-card-people";
import { ALL_CARD_PARTS, cardPartsView } from "@/lib/kanban/cardParts";
import { useCardParts } from "@/hooks/General/useCardParts";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { DraggableProvided, DraggableStateSnapshot } from "@hello-pangea/dnd";
import React, { useContext } from "react";
import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7350_CARD_TITLE_WRAP_FLAG } from "@/lib/flags/keys";

import { IAgent, IProject, ITask, IUser } from "@/models/model";
import { TBoardSubtaskSetting } from "@/models/Views/model";
import {
  daysSince,
  formatKanbanStalenessLine,
  stalenessLevel,
  taskStaleness,
} from "@/lib/staleness";
import { Clock } from "lucide-react";
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
    event?: React.MouseEvent<HTMLElement>,
  ) => void;
  selectionMode?: boolean;
  phoneHoldSelect?: boolean;
}

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
  phoneHoldSelect = false,
}: KanbanTaskCardProps) => {
  const isMobile = useContext(MobileViewContext);
  const cleanup = useFlag(HTPR_8255_KANBAN_CLEANUP_FLAG);
  const stableHoverLayout = useFlag(HTPR_8629_KANBAN_HOVER_LAYOUT_FLAG);
  const borderOnlySelect = useFlag(HTPR_8960_BORDER_ONLY_SELECT_FLAG);
  const cardOverflowClamp = useFlag(HTPR_8927_BOARD_CARD_OVERFLOW_FLAG);
  const calm = useFlag(HTPR_8970_CALM_CARDS_FLAG);
  const cardSettings = useFlag(HTPR_8971_CARD_SETTINGS_FLAG);
  const cardPeople = useFlag(HTPR_9026_CARD_PEOPLE_FLAG);
  const savedParts = useCardParts();
  const card = cardPartsView(task, blockingUser, cardSettings ? savedParts : ALL_CARD_PARTS);
  const subTasks = <CardSubTasks subTasks={card.subTasks} currentSetting={currentSetting} onClick={onSubtaskClick} />;
  return (
  <div
    ref={cardRef}
    tabIndex={0}
    id={`task-${task.id}`}
    className={cn(
      "outline-none rounded-[5px] xs:border-[1px] md:border-none xs:border-light-black-border-1",
      cardOverflowClamp && "min-w-0 max-w-full w-full",
      calm && "rounded-[4px]",
    )}
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
      selectionMode={selectionMode}
      onSelectToggle={
        borderOnlySelect && onSelectionClick
          ? (event) => onSelectionClick(task.id, event)
          : undefined
      }
      selectionControl={
        onSelectionClick && !borderOnlySelect ? (
          <SelectionCheckbox
            id={task.id}
            isChecked={selected}
            onClick={onSelectionClick}
            alwaysVisible={selectionMode}
            groupName="kanban-selection"
            className={cn(
              "absolute top-2 z-20 bg-cardBackground group-hover/kanban-selection:!visible",
              stableHoverLayout && !selectionMode && !selected ? "-left-2" : "left-2",
              phoneHoldSelect && isMobile && (selectionMode || selected) && "!flex",
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
      blocked={card.blocked}
      linkClassName={cn(
        calm && "px-3 py-2 gap-2",
        !stableHoverLayout && !borderOnlySelect && "group-hover/kanban-selection:pl-7",
        !borderOnlySelect && (selectionMode || selected) && "pl-7",
      )}
      parentClassName={cn(isArchivedOnBoard && "opacity-50", calm && "rounded-[4px]") || undefined}
    >
      <FlattenedParentTask
        parentTask={task.parentTask}
        currentSetting={currentSetting}
        onClick={onParentTaskClick}
      />
      <TaskTopRow
        task={task}
        project={project}
        updateActiveItemAndItemInView={updateActiveItemAndItemInView}
        setShowAssignModal={setShowAssignModal}
        eHandler={eHandler}
        _count={card.commentCount}
        notifications={card.notifications}
        ticketNumber={card.ticketNumber}
        assignees={cardSettings && cardPeople && !savedParts.people ? [] : assignedUsers}
        agentAssignees={cardSettings && cardPeople && !savedParts.people ? [] : agentAssignees}
        countNotifications={card.notificationCount}
        countSubtasks={card.subTaskCount}
        subTaskSetting={currentSetting}
        toggleDelete={toggleDelete}
        markTaskAsDone={markTaskAsDone}
        archiveNotificationCallback={archiveNotificationCallback}
        hover={hover}
        handleStarTask={handleStarTask}
        avatarSize={cleanup ? (isMobile ? 18 : 20) : undefined}
        staleClock={calm && card.staleness ? (
          <TaskStaleClock
            enabled={getActiveStalenessFromProject(project)}
            project={project}
            task={task}
          />
        ) : undefined}
      />
      <TaskTitle title={task.title} cardOverflowClamp={cardOverflowClamp} />
      <TaskTagsRow
        task={card.task}
        project={project}
        setShowEstimateModal={setShowEstimateModal}
        setShowPriorityModal={setShowPriorityModal}
        setShowCreateLabelModal={setShowCreateLabelModal}
        setShowAssignModal={setShowAssignModal}
        toggleDueDate={toggleDueDate}
        updateActiveItemAndItemInView={updateActiveItemAndItemInView}
        dueDate={card.dueDate}
        estimate={card.estimate!}
        priority={card.priority!}
        taskLabels={card.taskLabels}
        hasDraft={hasDraft}
        blockingUser={card.blockingUser}
        agents={cardSettings && cardPeople && !savedParts.people ? [] : agentAssignees}
        cardOverflowClamp={cardOverflowClamp}
      />
      {calm ? <div className="contents [&>div]:gap-1 [&>div>div]:gap-1 [&_span]:!text-micro [&_span]:leading-4">{subTasks}</div> : subTasks}
      {!calm && card.staleness && (
        <TaskStalenessLine
          enabled={getActiveStalenessFromProject(project)}
          project={project}
          task={task}
          cardOverflowClamp={cardOverflowClamp}
        />
      )}
    </TaskDraggableContainer>
  </div>
  );
};

const TaskStalenessLine = ({
  enabled,
  project,
  task,
  cardOverflowClamp,
}: {
  enabled: boolean;
  project?: IProject;
  task: ITask;
  cardOverflowClamp: boolean;
}) => {
  const snapshot = useFirstScreenSurface();
  const showFresh = useFlag(HTPR_7975_COLUMN_WORK_LIMITS_FLAG);
  if (!enabled) return null;

  const now = snapshot ? Date.parse(snapshot.now) : undefined;
  const columnDays = daysSince(task.sectionChangedAt ?? task.createdAt, now);
  const commentDays = daysSince(task.lastCommentAt ?? task.createdAt, now);
  const boardDays = daysSince(task.createdAt, now);
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
  }, showFresh);

  if (!ageLine) return null;

  return showFresh || level !== "none" ? (
    <p
      className={cn(
        "basis-full text-micro leading-none",
        cardOverflowClamp && "min-w-0 max-w-full truncate",
        level === "hot"
          ? "text-[var(--color-card-age-hot)]"
          : level === "warn"
            ? "text-[var(--color-card-age-warn)]"
            : "text-text-light-gray",
      )}
    >
      {ageLine}
    </p>
  ) : null;
};

const TaskStaleClock = ({
  enabled,
  project,
  task,
}: {
  enabled: boolean;
  project?: IProject;
  task: ITask;
}) => {
  const snapshot = useFirstScreenSurface();
  if (!enabled) return null;
  const staleness = taskStaleness(
    task,
    { warnDays: project?.staleWarnDays, hotDays: project?.staleHotDays },
    snapshot ? Date.parse(snapshot.now) : undefined,
  );
  if (staleness.level === "none") return null;
  const days = Math.max(staleness.daysInColumn ?? 0, staleness.daysSinceLastComment ?? 0);
  const detail = `On board ${staleness.daysOnBoard ?? 0}d\nIn this column ${staleness.daysInColumn ?? 0}d\nLast comment ${staleness.daysSinceLastComment ?? 0}d ago`;
  return (
    <span
      data-testid="card-stale-clock"
      data-level={staleness.level}
      title={detail}
      aria-label={detail}
      className={cn(
        "flex h-4 items-center gap-[3px] text-micro leading-4",
        staleness.level === "hot" ? "text-[var(--color-card-age-hot)]" : "text-[var(--color-card-age-warn)]",
      )}
    >
      <Clock size={12} strokeWidth={1.75} />
      {`${days}d`}
    </span>
  );
};

export const TaskTitle = ({
  title,
  cardOverflowClamp = false,
}: {
  title: string;
  cardOverflowClamp?: boolean;
}) => {
  const wrapBetweenWords = useFlag(HTPR_7350_CARD_TITLE_WRAP_FLAG);
  const calm = useFlag(HTPR_8970_CALM_CARDS_FLAG);
  return (
    <div
      className={cn(
        "flex flex-1 text-white-black",
        cardOverflowClamp && "min-w-0 max-w-full overflow-hidden",
      )}
    >
      <p
        className={cn(
          wrapBetweenWords ? "wrap-anywhere" : "break-all",
          "whitespace-pre-line text-left text-dense",
          cardOverflowClamp && "min-w-0 max-w-full",
          calm && "font-medium leading-snug",
        )}
      >
        {title}
      </p>
    </div>
  );
};

export default KanbanTaskCard;
