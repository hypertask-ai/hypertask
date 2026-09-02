import React from "react";
import DueDateLabel from "@/components/Labels/DueDateLabel";

interface TaskDueDateActivityLabelProps {
  dueDate: Date | string;
  currentDueDate: Date | string | null | undefined;
  isMobile: boolean;
  onClick: () => void;
}

const dateTime = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

export const isCurrentDueDate = (
  dueDate: Date | string,
  currentDueDate: Date | string | null | undefined,
) => {
  const activityTime = dateTime(dueDate);
  const currentTime = dateTime(currentDueDate);
  return activityTime !== null && activityTime === currentTime;
};

const TaskDueDateActivityLabel = ({
  dueDate,
  currentDueDate,
  isMobile,
  onClick,
}: TaskDueDateActivityLabelProps) => {
  const isEditable = isMobile && isCurrentDueDate(dueDate, currentDueDate);

  return (
    <DueDateLabel
      flexBasis={false}
      fontWeight={500}
      dueDate={dueDate}
      onClick={isEditable ? onClick : undefined}
      stopPropogation={isEditable}
      className={isEditable ? "cursor-pointer touch-manipulation" : undefined}
    />
  );
};

export default TaskDueDateActivityLabel;
