import Tooltip from "@/components/Common/Tooltip";
import TaskOptionsModal from "@/components/Modals/TaskOptions/TaskOptionsModal";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { ITask } from "@/models/model";
import { activeItemAtom, inViewObjectAtom } from "@/store";
import React, { useState } from "react";
import { Ellipsis, EllipsisVertical } from "lucide-react";
import { useRecoilState } from "@/lib/state";

interface IProps {
  hasNotifications: boolean;
  isArchived: boolean;
  navigateToNextTask?: (
    archiveNotification?: boolean,
    shouldNavigate?: boolean,
    remindMe?: boolean,
    force?: "forceNavigate",
    inboxFlow?: string | null
  ) => string | undefined;
  toggleDelete?: () => void;
  toggleRemind?: () => void;
  markAsDone?: (forceNavigate?: boolean | undefined) => void;
  task: ITask | null;
  isKanban: boolean;
  archiveNotification?: () => void;
  showTaskOptions: boolean;
  toggleTaskOptions: () => void;
  toggleRemoveSubtask: () => void;
  removeParentHandler: () => void;
  handleStarTask: () => void;
  followHandler: any;
  unfollowHandler: any;
}

const TaskDotOptions = (props: IProps) => {
  const {
    navigateToNextTask,
    toggleDelete,
    toggleRemind,
    markAsDone,
    task,
    isKanban,
    archiveNotification,
    showTaskOptions,
    toggleTaskOptions,
    toggleRemoveSubtask,
    removeParentHandler,
    handleStarTask,
    followHandler,
    unfollowHandler,
  } = props;

  const [_, setInViewObject] = useRecoilState(inViewObjectAtom);
  const [__, setActiveItem] = useRecoilState(activeItemAtom);
  const isApple = useDeviceContext();
  return (
    <>
      <div
        className={
          "cursor-pointer relative group flex justify-center items-center"
        }
      >
        {isKanban ? (
          <Ellipsis
            className={`h-[16px] w-[16px]  text-[#696b6e] hover:text-[#95999E]`}
            onClick={(e: any) => {
              e.preventDefault();
              e.stopPropagation();
              toggleTaskOptions();
              setActiveItem(task?.id!);
              setInViewObject({
                taskId: task?.id!,
                taskProjectId: task?.projectId ?? null,
                sectionId: task?.sectionId ?? null,
                taskTicketNumber: task?.ticketNumber ?? null,
                sectionTitle: task?.section ?? null,
                taskTitle: task?.title ?? null,
              });
            }}
           strokeWidth={1.75}/>
        ) : (
          <EllipsisVertical
            className={`h-[18px] w-[18px]  text-[#696b6e] hover:text-[#95999E]`}
            onClick={(e: any) => {
              e.preventDefault();
              e.stopPropagation();
              toggleTaskOptions();
            }}
           strokeWidth={1.75}/>
        )}

        <Tooltip
          left={isKanban ? -225 : 0}
          bottom={isKanban ? 30 : -40}
          text="Task Options"
          keyCombination={[isApple ? "CMD" : "CTRL", "SHIFT", "+"]}
        />
      </div>

      {showTaskOptions && (
        <TaskOptionsModal
          navigateToNextTask={navigateToNextTask}
          markTaskAsDone={markAsDone}
          toggle={toggleTaskOptions}
          toggleDelete={toggleDelete}
          toggleRemind={toggleRemind}
          currentTask={task}
          isKanban={isKanban}
          archiveNotification={archiveNotification}
          toggleRemoveSubtask={toggleRemoveSubtask}
          removeParentCallback={removeParentHandler}
          handleStarTask={handleStarTask}
          followHandler={followHandler}
          unfollowHandler={unfollowHandler}
        />
      )}
    </>
  );
};

export default TaskDotOptions;
