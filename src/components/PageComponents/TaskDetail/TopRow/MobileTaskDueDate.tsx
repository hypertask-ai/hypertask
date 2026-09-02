import React from "react";
import DueDateLabel from "@/components/Labels/DueDateLabel";
import { MOBILE_TARGET } from "@/lib/configs/general.config";

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
        className={`${MOBILE_TARGET} appearance-none bg-transparent text-left touch-manipulation`}
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
