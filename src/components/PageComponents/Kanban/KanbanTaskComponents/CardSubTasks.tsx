import { ITask } from "@/models/model";
import { TBoardSubtaskSetting } from "@/models/Views/model";
import { Check } from "lucide-react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8255_KANBAN_CLEANUP_FLAG } from "@/lib/flags/definitions/htpr-8255-kanban-cleanup";

const CardSubTasks = ({
  subTasks,
  currentSetting,
  onClick,
}: {
  subTasks?: ITask[];
  currentSetting?: TBoardSubtaskSetting;
  onClick?: (uniqueIndex: any) => void;
}) => {
  const cleanup = useFlag(HTPR_8255_KANBAN_CLEANUP_FLAG);
  return (currentSetting === "Flattened_Card" || currentSetting ==='Card') && subTasks && subTasks.length > 0 ? (
    <div className="flex flex-col w-full">
      {subTasks.map((task: ITask, index: number) => (
        <div
          key={`sub-task-tag-${task.id}-${index}`}
          className="flex gap-2 items-start w-full"
        >
          <Check
            className={`text-white-black stroke-[4px] min-w-fit mt-[2px] justify-self-start`}
            size={12}
            color={task?.status === "Archive" ? "green" : cleanup ? "#8e9093" : "#696b6e"}
           strokeWidth={1.75}/>
          <span
            className={`items-center line-clamp-2 text-meta w-fit hover:underline ${
              cleanup ? "text-[#cdd1d3]" : "text-label-component"
            }`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClick && onClick(task.uniqueIndex);
            }}
          >
            {task.ticketNumber}
            &nbsp;
            {task.title}
          </span>
        </div>
      ))}
    </div>
  ) : (
    <></>
  );
};

export default CardSubTasks;
