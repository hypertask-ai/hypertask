
import {
  ITaskArchiveActivity,
  ITaskAssignedActivity,
  ITaskDueDateActivity,
  ITaskEstimateActivity,
  ITaskLabelActivity,
  ITaskMoveActivity,
  ITaskPriorityActivity,
  ITaskPullRequestActivity,
  ITaskUpdateDescriptionActivity,
  ITaskWaitingOnActivity,
} from "@/models/ActivityModels.ts";

export function desktopCommentContainerClassname({
  isStacked = false,
  isActivity = undefined,
  currentId = null,
  commentId = "",
  editState = null,
  additionalClasses = "",
}: {
  isStacked?: boolean;
  isActivity?:
    | ITaskMoveActivity
    | ITaskPriorityActivity
    | ITaskAssignedActivity
    | ITaskEstimateActivity
    | ITaskLabelActivity
    | ITaskArchiveActivity
    | ITaskDueDateActivity
    | ITaskPullRequestActivity
    | ITaskUpdateDescriptionActivity
    | ITaskWaitingOnActivity;
  currentId?: string | null;
  commentId: string;
  editState?: number | null;
  additionalClasses?: string;
}) {
  const baseClasses = "border-l-4 rounded outline-none comment-container";

  const shadowClass = !isStacked && !isActivity ? "shadow-md" : "";

  const spacingCursorClass =
    isStacked || isActivity ? "my-[4px] cursor-pointer" : "my-[8px]";

  let borderAndBgClasses = "";
  const isSelected =
    currentId === `comment-${commentId}` ||
    currentId === `comment-${commentId}-input`;

  if (isSelected) {
    if (editState === Number(commentId)) {
      borderAndBgClasses = "border-[#C2CFA5]";
    } else {
      borderAndBgClasses = `border-selected-item-border ${
        isStacked || isActivity ? "bg-active-elementBg" : ""
      }`;
    }
  } else {
    if (isActivity) {
      borderAndBgClasses = "border-transparent hover:bg-active-elementBg";
    } else if (!isStacked) {
      borderAndBgClasses =
        "border-comment-description-border text-white-black bg-comment-description";
    } else {
      borderAndBgClasses = "border-transparent hover:bg-active-elementBg";
    }
  }

  return `${baseClasses} ${shadowClass} ${borderAndBgClasses} ${spacingCursorClass} ${additionalClasses}`.trim();
}
