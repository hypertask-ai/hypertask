import { ITask } from "@/models/model";
import { TBoardSubtaskSetting } from "@/models/Views/model";
import { Reply } from "lucide-react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8255_KANBAN_CLEANUP_FLAG } from "@/lib/flags/definitions/htpr-8255-kanban-cleanup";

const FlattenedParentTask = ({
  parentTask,
  currentSetting,
  onClick,
}: {
  parentTask?: ITask;
  currentSetting?: TBoardSubtaskSetting;
  onClick?: () => void;
}) => {
  const cleanup = useFlag(HTPR_8255_KANBAN_CLEANUP_FLAG);
  const handleOnClick = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    onClick && onClick();
  };

  return (currentSetting === "Flattened" || currentSetting === "Flattened_Card") && parentTask ? (
    <div
      className="flex w-full bg-cardBackground gap-2 items-center p-1 rounded text-header-text"
      onClick={handleOnClick}
    >
      <Reply
        className={"ml-1 font-medium"}
        size={12}
        style={{ transform: "scale(-1,1) rotate(90deg)" }}
       strokeWidth={1.75}/>
      <span
        className={`items-center line-clamp-1 text-meta w-fit font-medium hover:underline ${
          cleanup ? "text-[#cdd1d3]" : "text-label-component"
        }`}
      >
      {parentTask.ticketNumber}: {parentTask.title}
      </span>
    </div>
  ) : (
    <></>
  );
};

export default FlattenedParentTask;
