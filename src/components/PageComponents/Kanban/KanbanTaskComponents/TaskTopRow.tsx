import React, { useContext, useMemo } from "react";
import dynamic from "next/dynamic";
const Tooltip = dynamic(() => import("@/components/Common/Tooltip"), {
  ssr: false,
});
import CommentAndAssignees from "./CommentAndAssignees";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { Circle, Inbox } from "lucide-react";
import UserAvatar from "@/components/Common/UserAvatar";
import { useRecoilState } from "@/lib/state";
import { currentUserAtom } from "@/store";
import SubtaskCount from "./SubtaskCount";
import { TBoardSubtaskSetting } from "@/models/Views/model";
import HTCButton from "../../TaskDetail/TaskOptions/HTCButton";
import { IAgent, IProject, ITask, IUser } from "@/models/model";
import { useFlag } from "@/hooks/useFlag";
import { cn } from "@/utils/undoActions/helperFuncs";
import { HTPR_8970_CALM_CARDS_FLAG } from "@/lib/flags/definitions/htpr-8970-calm-cards";
import { HTPR_7339_AGENT_PULSE_DOT_FLAG } from "@/lib/flags/definitions/htpr-7339-agent-pulse-dot";
import { stackFaces, useCardAgentStatus, type CardAgentStatus } from "@/lib/agentStatus/cardStatus";
import AgentStatusDot from "@/lib/agentStatus/AgentStatusDot";
import { agentStatusDotMode, type AgentStatusDotMode } from "@/lib/agentStatus/dot";
import { useMinuteClock } from "@/lib/agentStatus/minuteClock";
import type { AgentStep } from "@/lib/agentStatus/chip";

const AGENT_STEP_DOT: Partial<Record<AgentStep, string>> = {
  working: "bg-[var(--color-pull-request-green)]",
  "in review": "bg-[var(--color-card-age-warn)]",
};

const AgentDot = ({ pulse, mode, step }: { pulse: boolean; mode: AgentStatusDotMode | null; step: AgentStep }) => {
  if (pulse) {
    return mode ? <AgentStatusDot mode={mode} className="absolute -bottom-px -right-px" /> : null;
  }
  const tone = AGENT_STEP_DOT[step];
  return tone ? (
    <span data-testid="agent-dot" data-step={step} className={cn("absolute -bottom-px -right-px h-2 w-2 rounded-full", tone)} />
  ) : null;
};

interface ITaskTopRow {
  task: ITask;
  project?: IProject;
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
  avatarSize?: number;
  staleClock?: React.ReactNode;
}
const TaskTopRow: React.FC<ITaskTopRow> = ({
  task,
  project,
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
  avatarSize,
  staleClock,
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
  const assigneeAvatarSize = avatarSize ?? (isMbl ? 18 : 22);

  const htcButtonCallback = () => updateTaskFocus(task);
  const calm = useFlag(HTPR_8970_CALM_CARDS_FLAG);
  const agentPulseDot = useFlag(HTPR_7339_AGENT_PULSE_DOT_FLAG);
  const agentStatus = useCardAgentStatus(task, project);
  const agentMinute = useMinuteClock(Boolean(task.agentStatus));
  const agentDotMode = agentPulseDot && agentStatus && task.agentStatus
    ? agentStatusDotMode(task.agentStatus.at, agentStatus.step, agentMinute)
    : null;
  const faces = stackFaces(assignees, agentAssignees, agentStatus?.agentName);
  const unread = notifications?.length > 0 && notifications[0]?.seen === false;
  const stackAvatars: React.ReactNode[] = [];
  const stackFace = (key: string, status: CardAgentStatus | null, avatar: React.ReactNode) => (
    <span key={key} className={cn("relative flex shrink-0", stackAvatars.length > 0 && "ml-[-8px]")}>
      {avatar}
      {status ? <AgentDot pulse={agentPulseDot} mode={agentDotMode} step={status.step} /> : null}
    </span>
  );
  for (const assignee of faces.users) {
    stackAvatars.push(stackFace(`user-${assignee.id}`, null,
      <UserAvatar alt={assignee.displayName} name={assignee.displayName} photoURL={assignee.photoURL} size={20} title={assignee.displayName} />)
    );
  }
  for (const agent of faces.agents) {
    const status = agent.displayName === agentStatus?.agentName ? agentStatus : null;
    stackAvatars.push(stackFace(`agent-${agent.id}`, status,
      <UserAvatar agentId={agent.id} alt={status ? status.text : `Assigned agent: ${agent.displayName}`}
        name={agent.displayName} photoURL={agent.photoURL} size={20} title={status ? status.text : agent.displayName} />)
    );
  }
  const statusAgentAssigned = faces.agents.some((agent) => agent.displayName === agentStatus?.agentName);
  if (agentPulseDot && agentStatus && agentDotMode && !statusAgentAssigned) {
    stackAvatars.push(stackFace("agent-status", agentStatus,
      <UserAvatar alt={agentStatus.text} name={agentStatus.agentName} size={20} title={agentStatus.text} />)
    );
  }

  return (
    <>
      <div className={cn("flex gap-1 flex-wrap basis-full items-center", calm && "[&>div.h-labelComponent]:!h-4 [&>div.h-labelComponent]:!px-0")}>
        <span className="flex flex-grow gap-1 items-center relative">
          {!calm && notifications &&
          notifications?.length > 0 &&
          notifications[0]?.seen === false ? (
            <Circle size={7} className="fill-current text-[#5896F1] w-new-notification relative" strokeWidth={1.75} fill="currentColor"/>
          ) : taskSaved && !(calm && hasNotifications) ? (
            <Circle size={7} className="fill-current text-[#FFCB33] w-new-notification relative" strokeWidth={1.75} fill="currentColor"/>
          ) : (
            <></>
          )}
          <p className={cn("task-ticket-id font-medium text-content sm:text-meta text-text-light-gray uppercase text-left", calm && "text-micro sm:text-micro leading-4")}>{`${ticketNumber}`}</p>
        </span>

        {isMbl ? (
          <></>
        ) : (
          <div className="relative flex h-4 w-[14px] shrink-0 items-center justify-center">
            {hover && <HTCButton isKanban={true} htcButtonCallback={htcButtonCallback} />}
          </div>
        )}
        {calm ? (
          hasNotifications && (
            <span
              role="button"
              aria-label={unread ? "New in your inbox" : "Also in your inbox"}
              title={unread ? "New in your inbox" : "Also in your inbox"}
              data-testid="card-inbox-flag"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                eHandler();
              }}
              className={cn("flex h-4 items-center cursor-pointer", unread ? "text-[var(--color-rich-text-link)]" : "text-text-light-gray")}
            >
              <Inbox size={12} strokeWidth={1.75} />
            </span>
          )
        ) : hasNotifications ? (
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
          compact={calm}
        />
        <CommentAndAssignees
          commentCount={_count}
          notifications={notifications}
          compact={calm}
        />
        {staleClock}

        {calm ? (
          stackAvatars.length > 0 && (
            <div
              data-testid="card-avatar-stack"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                updateActiveItemAndItemInView(task);
                setShowAssignModal(true);
              }}
              className="flex items-center"
            >
              {stackAvatars}
            </div>
          )
        ) : (assignees.length > 0 || agentAssignees.length > 0) && (
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
                    size={assigneeAvatarSize}
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
                size={assigneeAvatarSize}
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
