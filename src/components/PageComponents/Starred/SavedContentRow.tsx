import Tooltip from "@/components/Common/Tooltip";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { IComment, ITask } from "@/models/model";
import formatDateDifference from "@/utils/generateTime";
import { convertToPlain } from "@/utils/helperFunctions/helperFunctions";
import { Circle, Star, Check, Pin } from "lucide-react";



interface IProps {
  task: ITask;
  comment?: IComment;
  taskRef: React.RefObject<HTMLDivElement | null>;
  handleMouseLeave: () => void;
  handleMouseEnter: (index: number) => number;
  openTask: (task: ITask | null, comment?: IComment) => Promise<void>;
  selected: boolean;
  index: number;
  updatedAt: string;
  buttonClick: () => void;
  starType: "Task" | "Comment";
  pinComments?: boolean;
  archiveNotificationHandler?: () => void;
}

export const SavedContentRow = ({
  task,
  taskRef,
  handleMouseLeave,
  handleMouseEnter,
  openTask,
  selected,
  index,
  updatedAt,
  buttonClick,
  starType,
  comment,
  pinComments = false,
  archiveNotificationHandler,
}: IProps) => {
  return (
    <div
      id={`task-row-${index}`}
      onMouseEnter={() => handleMouseEnter(index)}
      onMouseLeave={handleMouseLeave}
      ref={taskRef}
      onClick={() => openTask(task, comment)}
      key={task.id}
      className={`flex space-x-0 md:space-x-8 cursor-pointer py-2 px-4 border-l-0 md:border-l-4 border-transparent rounded-md ${
        selected
          ? "md:bg-active-list-element md:border-l-selected-item-border"
          : "transparent"
      } justify-between  w-full flex-col md:flex-row`}
    >
      {starType === "Comment" && comment ? (
        <CreatorName
          name={comment.creator?.displayName}
          count={task._count?.comments ?? 0}
          updatedAt={updatedAt}
        />
      ) : (
        <ProjectName
          title={task.project?.title ?? task.project?.name}
          count={task._count?.comments ?? 0}
          archiveNotificationHandler={archiveNotificationHandler!}
          hasNotifications={
            !!(task.notifications && task.notifications.length > 0)
          }
          seen={
            task.notifications && task.notifications.length > 0
              ? task.notifications[0].seen
              : true
          }
          updatedAt={updatedAt}
        />
      )}

      {/* -------------- task title ----------------- */}
      <TaskTitleUniqueIndex
        title={task.title}
        ticketNumber={task.ticketNumber!}
      />
      {starType === "Comment" && <CommentText text={comment?.text ?? ""} />}
      <span
        style={{ color: "#8E9093", fontSize: 13 }}
        className="hidden md:block"
      >
        {formatDateDifference(updatedAt)}
      </span>
      {!pinComments ? (
        <StarredButtonGroup
          onClick={buttonClick}
          status={task.status ?? "Normal"}
          starType={starType}
        />
      ) : (
        <PinnedButtonGroup
          onClick={buttonClick}
          status={task.status ?? "Normal"}
        />
      )}
      <div className="border-b border-[hsla(216,8%,23%,0.2)] w-[90%] mx-auto my-2 block md:hidden" />
    </div>
  );
};

const StarredButtonGroup = ({
  onClick,
  status,
  starType,
}: {
  onClick: () => void;
  status: string;
  starType: "Comment" | "Task";
}) => {
  const isApple = useDeviceContext();
  return (
    <div className="hidden md:flex gap-1 items-center justify-center">
      <div
        tabIndex={-1}
        className="relative group"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <Tooltip
          left={-168}
          bottom={-40}
          text={starType === "Task" ? "Unstar task" : "Unstar comment"}
          keyCombination={
            starType === "Task"
              ? [`${!isApple ? "ALT" : "OPT"}`, "S"]
              : [`${!isApple ? "CTRL" : "CMD"}`, "SHIFT", "S"]
          }
        />
        <Star
          size={15}
          className="text-icon-dark-gray hover:text-header-text"
         strokeWidth={1.75}/>
      </div>
      <div tabIndex={-1} className="relative group">
        <Tooltip
          left={-200}
          bottom={-40}
          text={`${status === "Archive" ? "Unarchive" : "Archive"} task`}
          keyCombination={[`${!isApple ? "CTRL" : "CMD"}`, "E"]}
        />
        <Check size={15} color={status === "Archive" ? "green" : "#8E9093"}  strokeWidth={1.75}/>
      </div>
    </div>
  );
};

const PinnedButtonGroup = ({
  onClick,
  status,
}: {
  onClick: () => void;
  status: string;
}) => {
  const isApple = useDeviceContext();
  return (
    <div className="flex gap-1 items-center justify-center">
      <div
        tabIndex={-1}
        className="relative group"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <Tooltip
          left={-275}
          bottom={-40}
          text="Unpin comment"
          keyCombination={[`${!isApple ? "CTRL" : "CMD"}`, "SHIFT", "P"]}
        />
        <Pin
          size={15}
          className="text-icon-dark-gray hover:text-header-text"
         strokeWidth={1.75}/>
      </div>
      <div tabIndex={-1} className="relative group">
        <Tooltip
          left={-200}
          bottom={-40}
          text={`${status === "Archive" ? "Unarchive" : "Archive"} task`}
          keyCombination={[`${!isApple ? "CTRL" : "CMD"}`, "E"]}
        />
        <Check size={15} color={status === "Archive" ? "green" : "#8E9093"}  strokeWidth={1.75}/>
      </div>
    </div>
  );
};

const ProjectName = ({
  title,
  count,
  seen,
  hasNotifications,
  archiveNotificationHandler,
  updatedAt,
}: {
  title: string | undefined;
  count: number;
  seen: boolean;
  hasNotifications: boolean;
  archiveNotificationHandler: () => void;
  updatedAt: string;
}) => {
  return (
    <div className="flex w-full md:w-1/5 text-white-black overflow-hidden gap-2 items-center justify-between">
      <div className="flex gap-2 w-full items-center">
        <StarAndSeenDots starred={true} seen={seen} />
        <span
          style={{
            whiteSpace: "nowrap",
            fontSize: 13,
            overflow: "hidden" }}
        >
          {title ?? ""}
        </span>
        {count > 0 ? (
          <span className="text-[#8E9093] mx-1" style={{ fontSize: 13 }}>({count})</span>
        ) : (
          <></>
        )}
        {hasNotifications && (
          <span
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              archiveNotificationHandler();
            }}
            style={{
              fontSize: 11 }}
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
        )}
      </div>
      <span
        style={{ color: "#8E9093", fontSize: 13 }}
        className="flex md:hidden min-w-fit"
      >
        {formatDateDifference(updatedAt)}
      </span>
    </div>
  );
};

const CreatorName = ({
  name,
  count,
  updatedAt,
}: {
  name: string | undefined;
  count: number;
  updatedAt: string;
}) => {
  return (
    <div className="flex w-full md:w-1/5 text-white-black overflow-hidden justify-between items-center">
      <div className="flex gap-2 w-full items-center">
        <div className="w-new-notification">
          <Circle size={7} className="fill-current text-[#FFCB33] w-new-notification"  strokeWidth={1.75} fill="currentColor"/>
        </div>
        <span
          style={{
            whiteSpace: "nowrap",
            fontSize: 13,
            overflow: "hidden" }}
        >
          {name ?? ""}
        </span>
        {count > 0 ? (
          <span className="text-[#8E9093] mx-1" style={{ fontSize: 13 }}>({count})</span>
        ) : (
          <></>
        )}
      </div>
      <span
        style={{ color: "#8E9093", fontSize: 13 }}
        className="flex md:hidden min-w-fit"
      >
        {formatDateDifference(updatedAt)}
      </span>
    </div>
  );
};

const TaskTitleUniqueIndex = ({
  title,
  ticketNumber,
}: {
  title: string;
  ticketNumber: string;
}) => {
  return (
    <div className=" truncate flex-1 flex-column ml-0 md:ml-2 w-full md:w-1/3 text-white-black">
      <span
        className="font-bold text-icon-dark-gray"
        style={{ fontSize: 13 }}
      >
        {ticketNumber.toUpperCase() + " "}
      </span>
      <span
        //
        className="font-medium xs:whitespace-pre-wrap sm:whitespace-nowrap text-white-black text-dense"
      >
        {title ?? ""}
      </span>
    </div>
  );
};

const StarAndSeenDots = ({
  starred,
  seen,
}: {
  starred: boolean;
  seen: boolean;
}) => {
  return (
    <div
      className="group w-[12px] flex items-center justify-center relative"
      style={{ position: "relative", marginRight: "-2%" }}
    >
      {starred === true ? (
        <Circle size={7} className="fill-current text-[#FFCB33] w-new-notification relative z-9"  strokeWidth={1.75} fill="currentColor"/>
      ) : (
        <></>
      )}
      {seen === false ? (
        <Circle size={7}
          className={`fill-current text-[#5896F1] w-new-notification relative ${
            starred === true ? "-ml-[3px]" : "-ml-[0px]"
          } z-0`}
         strokeWidth={1.75} fill="currentColor"/>
      ) : (
        <></>
      )}
    </div>
  );
};

const CommentText = ({ text }: { text: string }) => {
  return (
    <div
      suppressHydrationWarning
      className="truncate flex-1 flex-column w-full text-white-black"
    >
      <span
        suppressHydrationWarning
        className="truncate line-clamp-1 xs:max-w-[92vw] md:max-w-full xs:whitespace-pre-wrap md:whitespace-nowrap"
        style={{
          color: "#8E9093",
          fontSize: 13 }}
      >
        {convertToPlain(text ?? "")}
      </span>
    </div>
  );
};
