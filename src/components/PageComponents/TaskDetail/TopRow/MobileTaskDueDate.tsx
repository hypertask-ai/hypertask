import React from "react";
import DueDateLabel from "@/components/Labels/DueDateLabel";

interface MobileTaskDueDateProps {
  dueDate: Date | string | null | undefined;
  isMobile: boolean;
  onClick: () => void;
}

const MobileTaskDueDate = ({
  dueDate,
  isMobile,
  onClick,
}: MobileTaskDueDateProps) => {
  if (!isMobile || !dueDate) return null;

  return (
    <div className="flex w-full py-2">
      <button
        type="button"
        aria-label="Change due date"
        className="appearance-none bg-transparent text-left touch-manipulation"
        onClick={onClick}
      >
        <DueDateLabel
          dueDate={dueDate}
          flexBasis={false}
          fontSize={12}
          fontWeight={500}
          isTaskInfo={true}
        />
      </button>
    </div>
  );
};

export default MobileTaskDueDate;
