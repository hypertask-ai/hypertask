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
  flushMobilePadding?: boolean;
  compactMobile?: boolean;
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
    flushMobilePadding = false,
    compactMobile = false,
  } = props;

  const isBulkSelected = false; // Not using bulk selection in scheduled view
  const isStarred = !!(task.savedContent && task.savedContent.length > 0);
  const isSeen =
    task.notifications && task.notifications.length > 0
      ? task.notifications[0].seen
      : true;
  let mobileDotColor = "bg-transparent";
  if (!isSeen) mobileDotColor = "bg-[#5896F1]";
  else if (isStarred) mobileDotColor = "bg-[#FFCB33]";

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
        "flex cursor-pointer @md:space-x-8 @md:py-[8px] @md:px-5 rounded-md justify-between w-full @md:flex-row @md:border-l-4",
        compactMobile
          ? "flex-row items-baseline gap-2 border-b border-border-light-gray-thin px-0 py-[9px] @md:items-stretch @md:gap-0 @md:border-b-0"
          : "flex-col px-[20px] py-[8px]",
        flushMobilePadding && "px-0",
        selected
          ? "@md:bg-active-elementBg @md:border-l-selected-item-border"
          : "@md:border-l-transparent bg-transparent"
      )}
    >
      {compactMobile && (
        <div className="flex min-w-0 flex-1 items-baseline gap-2 @md:hidden">
          <span
            aria-hidden="true"
            className={cn(
              "h-[7px] w-[7px] shrink-0 self-center rounded-full",
              mobileDotColor
            )}
          />
          <span className="shrink-0 text-[13px] font-bold text-icon-dark-gray">
            {task.ticketNumber}
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-white-black">
            {task.title}
          </span>
          <span
            className={cn(
              "ml-2 shrink-0 text-[13px] text-text-light-gray",
              isOverdue && "text-[#F88F9C]"
            )}
            suppressHydrationWarning
          >
            {showDueDate
              ? task.dueDate && formatDueDateDifference(task.dueDate)
              : task.updatedAt && formatDateDifference(task.updatedAt)}
          </span>
        </div>
      )}

      {/* First column: StarredDot & Notification Dot | Assignee Name | Comment Count */}
      <div
        className={cn(
          "flex @md:space-x-6 @md:min-w-[15%]",
          compactMobile && "hidden @md:flex"
        )}
      >
        <div className="flex justify-between w-100">
          <div className="gap-1 flex items-center min-w-0">
            <span className="flex @md:gap-[10px] items-center min-w-0">
              <StarAndSeenDots starred={isStarred} seen={isSeen} />
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
              "flex @md:hidden min-w-fit",
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
      <div
        className={cn(
          "flex min-w-0 flex-grow mt-2 @sm:mt-0 gap-2 items-baseline @md:items-center @md:w-[40%] flex-col @md:flex-row",
          compactMobile && "hidden @md:flex"
        )}
      >
        {/* ============ title =================  */}
        <div
          suppressHydrationWarning
          className="min-w-0 flex-1 flex-column @sm:flex-initial"
        >
          <span
            className="flex min-w-0 items-center truncate justify-start gap-1"
            style={{
              fontSize: 13 }}
          >
            {/* ================== priority label ============== */}

            <span className="font-bold text-icon-dark-gray text-nowrap">
              {task.ticketNumber}
            </span>
            <span className="min-w-0 flex-1 font-medium text-white-black truncate line-clamp-1">
              {task.title}
            </span>
          </span>
        </div>

        {/* ============ description content =========== */}
        <div
          suppressHydrationWarning
          className={cn(
            inboxConfig.bulkSelectionStyling.content(isBulkSelected),
            "min-w-0 w-full flex-1 truncate flex-column @md:min-w-[160px]"
          )}
        >
          <span
            suppressHydrationWarning
            className="block w-full max-w-full truncate whitespace-nowrap line-clamp-1"
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
      <div
        className={cn(
          "flex items-center justify-end gap-2 @md:min-w-[120px]",
          compactMobile && "hidden @md:flex"
        )}
      >
        {/* Archive status */}
        <div className="hidden @md:flex items-center">
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
            "hidden @md:block @md:min-w-[57px]",
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
      className={` cursor-pointer relative group @md:h-8
                        justify-start
                        whitespace-nowrap footer_tags_main items-center
                        @md:px-[10px] @lg:px-[15px]
                        text-content  flex  gap-1 `}
      onClick={onClick}
    >
      <div
        className={`flex items-baseline gap-1 font-normal ${
          isSelected ? "text-white-black" : "text-text-light-gray"
        }`}
      >
        <span className="footer_tags">{tab.project}</span>

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
      className="group @md:w-[10px] @md:left-0 flex items-center justify-center relative"
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
