// Add this to your classNameUtils.ts file

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

/**
 * Creates consistent comment container classes based on selection and stacking states
 * @param options Configuration options
 * @returns Class string
 */
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
  // Base classes that are always applied
  const baseClasses = "border-l-4 rounded outline-none comment-container";

  // Shadow class based on stacked or activity state
  const shadowClass = !isStacked && !isActivity ? "shadow-md" : "";

  // Spacing/cursor classes based on stacked or activity state
  const spacingCursorClass =
    isStacked || isActivity ? "my-[4px] cursor-pointer" : "my-[8px]";

  // Selected state and border classes (more complex logic)
  let borderAndBgClasses = "";
  const isSelected =
    currentId === `comment-${commentId}` ||
    currentId === `comment-${commentId}-input`;

  if (isSelected) {
    // Comment is selected
    if (editState === Number(commentId)) {
      // Comment is in edit state
      borderAndBgClasses = "border-[#C2CFA5]";
    } else {
      // Comment is selected but not in edit state
      borderAndBgClasses = `border-selected-item-border ${
        isStacked || isActivity ? "bg-active-elementBg" : ""
      }`;
    }
  } else {
    // Comment is not selected
    if (isActivity) {
      borderAndBgClasses = "border-transparent hover:bg-active-elementBg";
    } else if (!isStacked) {
      // Not an activity and not stacked
      borderAndBgClasses =
        "border-comment-description-border text-white-black bg-comment-description";
    } else {
      // Not an activity but stacked
      borderAndBgClasses = "border-transparent hover:bg-active-elementBg";
    }
  }

  // Combine all classes
  return `${baseClasses} ${shadowClass} ${borderAndBgClasses} ${spacingCursorClass} ${additionalClasses}`.trim();
}
