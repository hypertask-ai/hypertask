import {
  IEstimate,
  IPriority,
  IProject,
  ITask,
  ITaskLabel,
  IUser,
} from "@/models/model";
import { TBoardSubtaskSetting } from "@/models/Views/model";
import TaskDraggableContainer from "../../Kanban/KanbanTaskComponents/TaskDraggableContainer";
import FlattenedParentTask from "../../Kanban/KanbanTaskComponents/FlattenedParentTask";
import CardSubTasks from "../../Kanban/KanbanTaskComponents/CardSubTasks";
import { useContext } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import SubtaskCount from "../../Kanban/KanbanTaskComponents/SubtaskCount";
import CommentAndAssignees from "../../Kanban/KanbanTaskComponents/CommentAndAssignees";
import UserAvatar from "@/components/Common/UserAvatar";
import DueDateLabel from "@/components/Labels/DueDateLabel";
import PriorityLabelComponent from "@/components/Modals/TaskPriority/PriorityLabelComponent";
import EstimateLabelComponent from "@/components/Modals/TaskEstimate/EstimateLabelComponent";
import TaskLabelComponent from "@/components/Modals/CreateLabel/TaskLabelComponent";

export const ReadOnlyTask = ({
  task,
  currentSetting,
  project,
}: {
  task: ITask;
  currentSetting: TBoardSubtaskSetting;
  project: IProject;
}) => {
  const assignees = task.assignees
    ? task.assignees.map((item: { user: any }) =>
        "user" in item ? item.user : item
      )
    : [];

  return (
    <div
      tabIndex={0}
      id={`task-${task.id}`}
      className="outline-none rounded-[5px] xs:border-[1px] md:border-none xs:border-light-black-border-1 "
    >
      <TaskDraggableContainer
        taskHref={``}
        _currentProject={project}
        openDetail={() => {}}
        active={false}
        parentClassName="cursor-default"
        linkClassName="cursor-default"
      >
        <FlattenedParentTask
          parentTask={task.parentTask}
          currentSetting={currentSetting}
          onClick={() => {}}
        />
        <TaskTopRow
          _count={task._count?.comments}
          ticketNumber={task.ticketNumber ?? ""}
          assignees={assignees}
          countSubtasks={task.subTasks?.length ?? 0}
          subTaskSetting={currentSetting}
        />
        <div
          className={`text-white-black`}
          style={{ flex: 1, display: "flex" }}
        >
          <p
            style={{
              fontSize: 13,
              whiteSpace: "pre-line",
              textAlign: "initial",
              wordBreak: "break-all",
            }}
          >
            {task.title}
          </p>
        </div>
        <TaskTagsRow
          dueDate={task.dueDate}
          estimate={task.estimate!}
          priority={task.priority!}
          taskLabels={task.taskLabels}
        />
        <CardSubTasks
          subTasks={task.subTasks}
          currentSetting={currentSetting}
          onClick={() => {}}
        />
      </TaskDraggableContainer>
    </div>
  );
};

const TaskTopRow = ({
  assignees,
  ticketNumber,
  _count,
  countSubtasks,
  subTaskSetting,
}: {
  assignees: IUser[];
  ticketNumber: string;
  _count: any;
  countSubtasks: number;
  subTaskSetting?: TBoardSubtaskSetting;
}) => {
  const isMbl = useContext(MobileViewContext);

  return (
    <div className={`flex gap-1 flex-wrap basis-full items-center`}>
      <span className="flex flex-grow gap-1 items-center relative">
        <p className="font-medium text-content sm:text-meta text-text-light-gray uppercase text-left">{`${ticketNumber}`}</p>
      </span>

      <SubtaskCount
        countSubTask={countSubtasks}
        currentSetting={subTaskSetting}
      />
      <CommentAndAssignees commentCount={_count} notifications={[]} />

      {assignees.length > 0 && (
        <div className="flex items-center ">
          {assignees
            .slice(0, 5)
            .map((user: IUser, index: React.Key | null | undefined) => (
              <UserAvatar
                key={index}
                alt=""
                name={user.displayName}
                photoURL={user.photoURL}
                size={isMbl ? 18 : 22}
                className={`${
                  index === 0 ? "ml-[0px] " : "ml-[-14px]"
                }`}
                title={user.displayName}
              />
            ))}
        </div>
      )}
    </div>
  );
};

const TaskTagsRow = ({
  dueDate,
  priority,
  estimate,
  taskLabels,
}: {
  dueDate: Date | undefined;
  priority: IPriority;
  estimate: IEstimate;
  taskLabels?: ITaskLabel[];
}) => {
  if (
    !priority &&
    !estimate &&
    !dueDate &&
    (!taskLabels || taskLabels?.length === 0)
  )
    return <></>;
  return (
    <div className={`basis-full flex gap-1 flex-wrap`}>
      {dueDate ? (
        <DueDateLabel
          stopPropogation={true}
          flexBasis={false}
          fontWeight={500}
          onClick={() => {}}
          dueDate={dueDate}
        />
      ) : (
        <></>
      )}
      {priority && (
        <PriorityLabelComponent
          stopPropogation={true}
          flexBasis={false}
          fontWeight={500}
          onClick={() => {}}
          priority={priority}
        />
      )}
      {estimate && (
        <EstimateLabelComponent
          flexBasis={false}
          fontWeight={500}
          onClick={() => {}}
          estimate={estimate}
        />
      )}
      {taskLabels?.map((taskLabel, index) => (
        <TaskLabelComponent
          key={`Label-component-${taskLabel.id}`}
          stopPropogation={true}
          fontWeight={500}
          onClick={() => {}}
          flexBasis={false}
          labelValue={taskLabel.label?.value ?? ""}
        />
      ))}
    </div>
  );
};
