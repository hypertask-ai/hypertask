import React, { useContext, useMemo } from "react";
// import Tooltip from '@/components/Common/Tooltip';
const Tooltip = dynamic(() => import("@/components/Common/Tooltip"), {
  ssr: false,
});
import CommentAndAssignees from "./CommentAndAssignees";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { Circle } from "lucide-react";
import dynamic from "next/dynamic";
import UserAvatar from "@/components/Common/UserAvatar";
import { useRecoilState } from "@/lib/state";
import { currentUserAtom } from "@/store";
import SubtaskCount from "./SubtaskCount";
import { TBoardSubtaskSetting } from "@/models/Views/model";
import HTCButton from "../../TaskDetail/TaskOptions/HTCButton";
import { IAgent, ITask, IUser } from "@/models/model";

interface ITaskTopRow {
  task: ITask;
  updateActiveItemAndItemInView: (task: ITask) => void;
  setShowAssignModal: React.Dispatch<React.SetStateAction<boolean>>;
  toggleDelete: () => void;
  countNotifications?: number;
  assignees: IUser[];
  agentAssignees: IAgent[];
  ticketNumber: string;
  notifications: any;
  _count: any;
  eHandler: () => void;
  countSubtasks: number;
  subTaskSetting?: TBoardSubtaskSetting;
  markTaskAsDone: () => void;
  hover: boolean;
  archiveNotificationCallback: () => void;
  handleStarTask: () => void;
}
const TaskTopRow: React.FC<ITaskTopRow> = ({
  task,
  updateActiveItemAndItemInView,
  setShowAssignModal,
  assignees,
  agentAssignees,
  countNotifications,
  ticketNumber,
  notifications,
  _count,
  eHandler,
  countSubtasks,
  subTaskSetting,
  hover,
}) => {
  const updateTaskFocus = updateActiveItemAndItemInView;
  const taskSaved =
    (task.savedContent?.length ?? 0) > 0 ||
    (task._count?.savedContent ?? 0) > 0;
  const hasNotifications = useMemo(() => {
    if (countNotifications && countNotifications > 0) return true;
    else return false;
  }, [countNotifications]);

  const [_, _setCurrentUser] = useRecoilState(currentUserAtom);

  const isMbl = useContext(MobileViewContext);

  const htcButtonCallback = () => updateTaskFocus(task);

  return (
    <>
      <div
        className={`flex gap-1 flex-wrap basis-full items-center
 
        `}
      >
        <span className="flex flex-grow gap-1 items-center relative">
          {notifications &&
          notifications?.length > 0 &&
          notifications[0]?.seen === false ? (
            <Circle size={7} className="fill-current text-[#5896F1] w-new-notification relative" strokeWidth={1.75} fill="currentColor"/>
          ) : taskSaved ? (
            <Circle size={7} className="fill-current text-[#FFCB33] w-new-notification relative" strokeWidth={1.75} fill="currentColor"/>
          ) : (
            <></>
          )}
          <p className="task-ticket-id font-medium text-content sm:text-meta text-text-light-gray uppercase text-left">{`${ticketNumber}`}</p>
        </span>

        {/* ====================== in inbox? ================== */}
        {isMbl ? (
          <></>
        ) : (
          hover && (
            <HTCButton isKanban={true} htcButtonCallback={htcButtonCallback} />
          )
        )}
        {hasNotifications ? (
          <span
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              eHandler();
            }}
            style={{
              fontSize: 12,
            }}
            className={`
                relative group
                whitespace-nowrap
                border-[1px] border-light-black-border-1
                bg-white-black-inverted text-white-black font-bold
                py-[1px] 
                px-[6px] 
                h-labelComponent
                rounded-sm`}
          >
            In inbox
            <Tooltip
              left={-100}
              bottom={30}
              text="Remove notification"
              keyCombination={["E"]}
              shouldReAdjustToViewport={false}
            />
          </span>
        ) : (
          <></>
        )}
        <SubtaskCount
          countSubTask={countSubtasks}
          currentSetting={subTaskSetting}
        />
        <CommentAndAssignees
          commentCount={_count}
          notifications={notifications}
        />

        {(assignees.length > 0 || agentAssignees.length > 0) && (
          <div
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              updateActiveItemAndItemInView(task);
              setShowAssignModal(true);
            }}
            className="flex items-center"
          >
            {assignees
              .slice(0, 5)
              .map(
                (
                  assignee,
                  index: React.Key | null | undefined
                ) => (
                  <UserAvatar
                    key={index}
                    alt=""
                    className={`${
                      index === 0 ? "ml-[0px] " : "ml-[-14px]"
                    }`}
                    name={assignee.displayName}
                    photoURL={assignee.photoURL}
                    size={isMbl ? 18 : 22}
                    title={assignee.displayName}
                  />
                )
              )}
            {agentAssignees.slice(0, 5).map((agent, index) => (
              <UserAvatar
                agentId={agent.id}
                key={agent.id}
                alt={`Assigned agent: ${agent.displayName}`}
                className={`${
                  assignees.length > 0 || index > 0 ? "ml-[-14px]" : "ml-[0px]"
                }`}
                name={agent.displayName}
                photoURL={agent.photoURL}
                size={isMbl ? 18 : 22}
                title={agent.displayName}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default TaskTopRow;
