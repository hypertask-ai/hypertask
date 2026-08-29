import React from "react";
import { Circle } from "lucide-react";
import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import { ITaskInfo } from "@/models/InteractiveOnboarding/model";
import AssigneeModal from "../../Modals/AssigneeModal";
import PriorityModal from "../../Modals/PriorityModal";
import DueDateModal from "../../Modals/DueDateModal";
import { getStyle } from "@/lib/constants/InteractiveOnboarding/constants";
import TaskLabelComponent from "@/components/Modals/CreateLabel/TaskLabelComponent";
import {
  TaskInfoColumnContainer,
  TaskInfoLabel,
  TaskInfoRow,
  TaskInfoValue,
} from "@/components/PageComponents/TaskDetail/MainPageComponents";

interface IProp {
  task: ITaskInfo;
}

const TaskInfoContainer = ({ task }: IProp) => {
  const { activeScene, sceneState, activeTaskPage } = useTutorialContext();
  const { status, id, assignees, dueDate, priority, taskSize, tags, project } =
    task;

  return (
    <>
      <TaskInfoColumnContainer
        style={{ top: 103 }}
        mobileResponsive={false}
      >
        {/* ====================================== ASSIGNEES ================================ */}
        <TaskInfoRow>
          <TaskInfoLabel>Assignees</TaskInfoLabel>
          <TaskInfoValue className="flex flex-col">
            {assignees && assignees.length > 0 ? (
              <div className="space-y-3 rounded-[4px] relative group">
                {assignees.map((item, index) => (
                  <div
                    key={`assignee-task-info-${index}`}
                    className="flex items-center space-x-2 font-medium"
                  >
                    <div>
                      <img
                        style={getStyle(item.pfp, 15)}
                        src={item.pfp}
                        alt="pfp"
                        className="object-cover"
                      />
                    </div>
                    <p>{item.name}</p>
                  </div>
                ))}
              </div>
            ) : (
              activeTaskPage === 0 && (
                <span className="relative group" style={{ color: "#8E9093" }}>
                  The Assignees
                </span>
              )
            )}
          </TaskInfoValue>
        </TaskInfoRow>

        {/* ===================================== TASK ID ====================================== */}
        <TaskInfoRow>
          <TaskInfoLabel>ID</TaskInfoLabel>
          <TaskInfoValue className="uppercase">{id}</TaskInfoValue>
        </TaskInfoRow>

        {/* ====================================== TASK STATUS ================================ */}
        <TaskInfoRow>
          <TaskInfoLabel>Status</TaskInfoLabel>
          <TaskInfoValue className="group w-full">
            <span className="text-text-light-gray w-full">{status}</span>
          </TaskInfoValue>
        </TaskInfoRow>

        {/* ====================================== TASK DUE DATE ================================ */}
        <TaskInfoRow>
          <TaskInfoLabel>Due Date</TaskInfoLabel>
          <TaskInfoValue className="group">-</TaskInfoValue>
        </TaskInfoRow>

        {/* ====================================== TASK PROJECT ================================ */}
        <TaskInfoRow>
          <TaskInfoLabel>Project</TaskInfoLabel>
          <TaskInfoValue className="group">{project}</TaskInfoValue>
        </TaskInfoRow>

        {/* ====================================== TASK Priority ================================ */}
        <TaskInfoRow>
          <TaskInfoLabel>Priority</TaskInfoLabel>
          <TaskInfoValue className="group">
            {!priority ? (
              <span className="text-text-light-gray w-full">No Priority</span>
            ) : (
              <div
                style={{ fontSize: 12, fontWeight: 600 }}
                className="flex gap-2 items-center h-labelComponent border-[1px] bg-inherit border-border-labelComponent rounded-sm px-[6px] py-[1px] w-fit text-label-component"
              >
                <div className="flex gap-1 items-center">
                  <Circle size={7}
                    color={priority?.colorCode}
                    className="fill-current w-new-notification"
                   strokeWidth={1.75} fill="currentColor"/>
                  <span className="h-fit rounded-sm">
                    {priority.Priority_Value}
                  </span>
                </div>
              </div>
            )}
          </TaskInfoValue>
        </TaskInfoRow>

        {/* ====================================== TASK Estimate ================================ */}
        <TaskInfoRow>
          <TaskInfoLabel>Task Size</TaskInfoLabel>
          <TaskInfoValue className="group">
            {!taskSize ? (
              <span className="text-text-light-gray w-full">-</span>
            ) : (
              <div
                style={{ fontSize: 12, fontWeight: 600 }}
                className="flex gap-2 items-center h-labelComponent border-[1px] bg-inherit border-border-labelComponent rounded-sm px-[6px] py-[1px] w-fit text-label-component"
              >
                <div className="flex gap-1 items-center">
                  <span className="h-fit rounded-sm">
                    {taskSize.estimate_value}
                  </span>
                </div>
              </div>
            )}
          </TaskInfoValue>
        </TaskInfoRow>
        {/* ====================================== TASK Labels ================================ */}
        <TaskInfoRow>
          <TaskInfoLabel>Tags</TaskInfoLabel>
          {tags && tags.length > 0 ? (
            <TaskInfoValue className="flex flex-wrap gap-2 cursor-pointer group">
              {tags.map((taskLabel, idx) => (
                <TaskLabelComponent
                  key={idx}
                  flexBasis={false}
                  stopPropogation={false}
                  labelValue={taskLabel}
                />
              ))}
            </TaskInfoValue>
          ) : (
            <TaskInfoValue className="text-start cursor-pointer group">
              <span className="text-text-light-gray w-full">No Tags</span>
            </TaskInfoValue>
          )}
        </TaskInfoRow>
      </TaskInfoColumnContainer>
      {activeScene.index === 8 && <AssigneeModal />}
      {activeScene.index === 10 && <PriorityModal />}
      {activeScene.index === 17 && <DueDateModal />}
    </>
  );
};

export default TaskInfoContainer;
