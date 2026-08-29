import { ITask } from "@/models/model";
import React from "react";
import { convertToPlain } from "@/utils/helperFunctions/helperFunctions";
import formatDateDifference, {
  formatDueDateDifference,
} from "@/utils/generateTime";
import { Check, Circle } from "lucide-react";
import TaskRowContainer from "./TaskRowContainer";
import { cn } from "@/utils/undoActions/helperFuncs";
import { inboxConfig } from "@/lib/configs/inbox.config";

interface IProps {
  task: ITask;
  handleMouseEnter: (index: number) => void;
  handleMouseLeave: () => void;
  handleLinkClick: (task: ITask, idx: number) => Promise<void>;
  index: number;
  selected: boolean;
  showDueDate?: boolean;
  isOverdue?: boolean;
}

export const TaskListRow = (props: IProps) => {
  const {
    task,
    handleLinkClick,
    handleMouseEnter,
    handleMouseLeave,
    index,
    selected,
    showDueDate = false,
    isOverdue = false,
  } = props;

  const isBulkSelected = false; // Not using bulk selection in scheduled view

  // Get assignee name or task owner name
  const assigneeName =
    task.assignees && task.assignees.length > 0
      ? task.assignees
          .slice(0, 5)
          .map((assignee) => assignee.user?.displayName)
          .filter(Boolean)
          .join(", ")
      : task.user?.displayName || "";

  const handleClick = () => {
    handleLinkClick(task, index);
  };

  return (
    <TaskRowContainer
      index={index}
      selected={selected}
      divId={task.id}
      taskRef={undefined}
      divType="inbox"
      handleMouseEnter={handleMouseEnter}
      handleMouseLeave={handleMouseLeave}
      openTask={handleClick}
      className={cn(
        "flex cursor-pointer md:space-x-8 py-[8px] px-[20px] md:px-5 rounded-md justify-between w-full flex-col md:flex-row md:border-l-4",
        selected
          ? "md:bg-active-elementBg md:border-l-selected-item-border"
          : "md:border-l-transparent bg-transparent"
      )}
    >
      {/* First column: StarredDot & Notification Dot | Assignee Name | Comment Count */}
      <div className="flex md:space-x-6 md:min-w-[15%]">
        <div className="flex justify-between w-100">
          <div className="gap-1 flex items-center">
            <span className="flex md:gap-[10px] items-center">
              <StarAndSeenDots
                starred={!!(task.savedContent && task.savedContent.length > 0)}
                seen={
                  task.notifications && task.notifications.length > 0
                    ? task.notifications[0].seen
                    : true
                }
              />
              {showDueDate
                ? assigneeName && (
                    <span
                      className={cn(
                        inboxConfig.bulkSelectionStyling.username(isBulkSelected)
                      )}
                    >
                      {assigneeName}
                    </span>
                  )
                : task.project?.title && (
                    <span
                      className={cn(
                        inboxConfig.bulkSelectionStyling.username(isBulkSelected)
                      )}
                    >
                      {task.project.title}
                    </span>
                  )
              }
            </span>
            {task._count?.comments && task._count?.comments > 0 ? (
              <span className="text-[#8E9093]">({task._count?.comments})</span>
            ) : (
              <></>
            )}
          </div>
          {/* Mobile timestamp */}
          <span
            className={cn(
              inboxConfig.bulkSelectionStyling.timestamp(isBulkSelected),
              "flex md:hidden min-w-fit",
              isOverdue && "text-[#F88F9C]"
            )}
            suppressHydrationWarning
            style={{
              fontSize: 13,
              color: isOverdue ? "#F88F9C" : undefined }}
          >
            {showDueDate
              ? task.dueDate && formatDueDateDifference(task.dueDate)
              : task.updatedAt && formatDateDifference(task.updatedAt)}
          </span>
        </div>
      </div>

      {/* Second column: Title Container (ticket number, title, labels) | Description */}
      <div className="flex flex-grow xs:mt-2 sm:mt-0 gap-2 items-baseline md:items-center md:w-[40%] flex-col md:flex-row">
        {/* ============ title =================  */}
        <div
          suppressHydrationWarning
          className="truncate flex-1 flex-column sm:flex-initial"
        >
          <span
            className="flex items-center truncate justify-start gap-1 xs:flex-wrap md:flex-nowrap"
            style={{
              fontSize: 13 }}
          >
            {/* ================== priority label ============== */}

            <span className="font-bold text-icon-dark-gray text-nowrap">
              {task.ticketNumber}
            </span>
            <span className="font-medium text-white-black truncate line-clamp-1">
              {task.title}
            </span>
          </span>
        </div>

        {/* ============ description content =========== */}
        <div
          suppressHydrationWarning
          className={cn(
            inboxConfig.bulkSelectionStyling.content(isBulkSelected),
            "flex-1 truncate flex-column md:min-w-[160px]"
          )}
        >
          <span
            suppressHydrationWarning
            className="truncate line-clamp-1 xs:max-w-[92vw] md:max-w-full xs:whitespace-pre-wrap md:whitespace-nowrap"
            style={{
              fontSize: 13 }}
          >
            {typeof window !== "undefined" &&
              convertToPlain(
                task.description_?.content ?? task.description ?? ""
              )}
          </span>
        </div>
      </div>

      {/* Third column: Archive status | Due date Label | Time */}
      <div className="flex items-center justify-end gap-2 md:min-w-[120px]">
        {/* Archive status */}
        <div className="hidden md:flex items-center">
          <Check
            size={15}
            color={task.status === "Archive" ? "green" : "#8E9093"}
            strokeWidth={1.75}
          />
        </div>

        {/* Desktop timestamp */}
        <span
          className={cn(
            inboxConfig.bulkSelectionStyling.timestamp(isBulkSelected),
            "hidden md:block md:min-w-[57px]",
            isOverdue && "text-[#F88F9C]"
          )}
          suppressHydrationWarning
          style={{
            fontSize: 13,
            color: isOverdue ? "#F88F9C" : undefined }}
        >
          {showDueDate
            ? task.dueDate && formatDueDateDifference(task.dueDate)
            : task.updatedAt && formatDateDifference(task.updatedAt)}
        </span>
      </div>
    </TaskRowContainer>
  );
};

export const SplitTitle = ({
  tab,
  isSelected,
  onClick,
}: {
  tab: {
    idx: number;
    project: string;
    length: number;
    hasUnseen: boolean;
  };
  isSelected: boolean;
  onClick: any;
}) => {
  return (
    <div
      key={tab.project?.toString()}
      className={` cursor-pointer relative group md:h-8
                        justify-start
                        whitespace-nowrap footer_tags_main items-center
                        md:px-[10px] lg:px-[15px]
                        text-content  flex  gap-1 `}
      onClick={onClick}
    >
      <div
        className={`flex items-baseline gap-1 font-normal ${
          isSelected ? "text-white-black" : "text-text-light-gray"
        }`}
      >
        <h2 className={`footer_tags `}>{tab.project}</h2>

        {tab.length > 0 && (
          <p className="font-normal footer_tags text-micro ">{tab.length}</p>
        )}
      </div>
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
      className="group md:w-[10px] xs:left-[-14px] md:left-0 flex items-center justify-center relative"
      style={{ position: "relative", marginRight: "-2%" }}
    >
      {seen === false ? (
        <Circle size={7} className="fill-current text-[#5896F1] w-new-notification relative" strokeWidth={1.75} fill="currentColor" />
      ) : starred === true ? (
        <Circle size={7} className="fill-current text-[#FFCB33] w-new-notification relative" strokeWidth={1.75} fill="currentColor" />
      ) : (
        <></>
      )}
    </div>
  );
};
