import { ITask } from "@/models/model";
import { TBoardSubtaskSetting } from "@/models/Views/model";
import { Reply } from "lucide-react";

const FlattenedParentTask = ({
  parentTask,
  currentSetting,
  onClick,
}: {
  parentTask?: ITask;
  currentSetting?: TBoardSubtaskSetting;
  onClick?: () => void;
}) => {
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
      <span className="items-center line-clamp-1 text-meta w-fit text-label-component font-medium hover:underline">
      {parentTask.ticketNumber}: {parentTask.title}
      </span>
    </div>
  ) : (
    <></>
  );
};

export default FlattenedParentTask;
