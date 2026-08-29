import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { ITask } from "@/models/model";
import { Check } from "lucide-react";

const SharedDescriptionSubtasks = () => {
  const { currentTask } = useTaskContext();

  return (
    <div className="flex flex-col gap-1">
      {currentTask?.subTasks && currentTask.subTasks.length > 0 && (
        <>
          <span className="text-white-black text-content font-semibold mt-3">
            Sub-tasks
          </span>
          <hr className="h-[0.2px] text-[#8E9093] mb-2" />

          {currentTask.subTasks.map((task: ITask, index: number) => {
            return (
              <div
                key={`sub-task-description-${index}`}
                className="inline-flex gap-2 items-center w-full"
              >
                <Check
                  className={`text-white-black stroke-[4px] min-w-fit mt-[2px] align-top justify-self-start`}
                  size={12}
                  color={task?.status === "Archive" ? "green" : "#696b6e"}
                 strokeWidth={1.75}/>
                <span className="w-full block text-meta text-[#8E9093]  font-medium items-start justify-normal group hover:underline cursor-pointer">
                  <span className="w-fit text-nowrap">
                    {task.ticketNumber}&nbsp;
                  </span>
                  <span className="text-white-black group-hover:underline w-fit">
                    {task.title}
                  </span>
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
};

export default SharedDescriptionSubtasks;
