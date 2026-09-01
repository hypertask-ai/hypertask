import Tooltip from "@/components/Common/Tooltip";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { ITask } from "@/models/model";
import { tasksPlayListAtom } from "@/store";
import Link from "next/link";
import { useMemo } from "react";
import { Plus, Check } from "lucide-react";

import { useRecoilState } from "@/lib/state";
import CreateSummaryButton from "../../../TopRow/CreateSummaryButton";
import { taskDetailSpacing } from "@/lib/configs/taskDetail.config";
import { cn } from "@/utils/undoActions/helperFuncs";
import { useTaskPages } from "./TaskPagesContext";
import { useSearchParams } from "next/navigation";
import { preserveInboxFlowOnTaskHref } from "@/lib/taskDetailInboxFlow";

const DescriptionSubTask = () => {
  const { currentTask, editMode, toggleSubtaskLinkingModal } = useTaskContext();
  const { loading, hasPages, createAndOpenPage } = useTaskPages();
  const inboxFlow = useSearchParams()?.get("inboxFlow");
  const [_, setTasksPlayList] = useRecoilState(tasksPlayListAtom);
  const isApple = useDeviceContext();
  var cmdControl = useMemo(
    () => (isApple && "CMD") || (!isApple && "CTRL"),
    [isApple]
  );

  const subTaskPlaylist = useMemo(() => {
    if (currentTask?.subTasks && currentTask?.subTasks.length > 0) {
      const parent = {
        projectId: currentTask?.projectId,
        uniqueIndex: currentTask?.uniqueIndex,
      };
      const subtaskPlaylist = currentTask?.subTasks.map((task: ITask) => ({
        projectId: task.projectId,
        uniqueIndex: task.uniqueIndex,
      }));
      return [parent, ...subtaskPlaylist];
    } else {
      return [];
    }
  }, [currentTask?.subTasks, currentTask?.projectId, currentTask?.uniqueIndex]);

  return editMode !== "description" && editMode !== "description-ai" ? (
    <div className={cn("flex flex-col gap-1", taskDetailSpacing.mobile.descriptionContainer)}>
      {currentTask?.subTasks && currentTask.subTasks.length > 0 && (
        <>
          <span className="text-[#8E9093] text-meta font-normal mt-3">
            Sub-tasks
          </span>

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
                <Link
                  href={preserveInboxFlowOnTaskHref(
                    `/detail/project-${currentTask?.projectId}/${task.uniqueIndex}`,
                    inboxFlow,
                  )}
                  onClick={() => {
                    setTasksPlayList(subTaskPlaylist);
                  }}
                  className="w-full block text-meta text-[#8E9093]  font-medium items-start justify-normal group hover:underline cursor-pointer"
                >
                  <span className="w-fit text-nowrap">
                    {task.ticketNumber}&nbsp;
                  </span>
                  <span className="text-white-black group-hover:underline w-fit">
                    {task.title}
                  </span>
                </Link>
              </div>
            );
          })}
        </>
      )}

      <div className="flex items-center justify-between text-meta text-text-light-gray">
        <div className="flex items-center gap-4">
          <span
            onClick={toggleSubtaskLinkingModal}
            className="w-fit inline-flex items-center text-meta text-text-light-gray hover:text-white-black mt-2 mb-3 group cursor-pointer relative"
          >
            <Plus size={8} className="mr-1" strokeWidth={1.75} />
            Add sub-tasks
            <Tooltip
              left={0}
              bottom={-40}
              keyCombination={[cmdControl, "SHIFT", "+"]}
              text={"Create sub-task"}
            />
          </span>

          {!loading && !hasPages && (
            <span
              onClick={() => void createAndOpenPage()}
              className="w-fit inline-flex items-center text-meta text-text-light-gray hover:text-white-black mt-2 mb-3 group cursor-pointer relative"
            >
              <Plus size={8} className="mr-1" strokeWidth={1.75} />
              Add page
            </span>
          )}
        </div>

        <CreateSummaryButton/>
      </div>
    </div>
  ) : (
    <></>
  );
};

export default DescriptionSubTask;
