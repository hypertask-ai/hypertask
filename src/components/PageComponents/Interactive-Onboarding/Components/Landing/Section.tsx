import { useTutorialContext } from "@/lib/contexts/Interactive-Onboarding/TutorialGlobalProvider";
import { IBoardTask } from "@/models/InteractiveOnboarding/model";
import React from "react";
import { Plus } from "lucide-react";
import Task from "./Task";

type Props = {
  index: number;
  title: string;
  taskCount: number;
  tasks: IBoardTask[];
  showBottomButton: boolean;
};

const Section = ({
  index,
  title,
  taskCount,
  tasks,
  showBottomButton,
}: Props) => {
  const { activeTask, activeColumn } = useTutorialContext();

  return (
    <div
      key={`section-${index}`}
      className={
        "max-w-[98vw]  mt-4 border-[1px] border-pageBackground group/main focus:border-[1px] focus:border-white-black mobileResponsive md:min-w-[404px] flex flex-col items-start h-auto focus:outline-none  bg-containerBackground shadow-md rounded-md max-h-inherit section-container relative"
      }
    >
      <div
        style={{ scrollBehavior: "unset" }}
        className={
          "overflow-y-auto w-full sm:pb-20 h-full max-h-inherit scrollbar hover:scrollbar-thumb-gray-500 scrollbar-thumb-[#D3D1CB] scrollbar-track-kanban-column-scrollbar dark:scrollbar-thumb-[#4F5766] scrollbar-corner-button-arrow-disabled"
        }
      >
        {/*-------------------TITLE AND TASKS */}
        <SectionHeader title={title} taskCount={taskCount} />

        {/* tasks */}
        <div id={`tasks-list-${2}`} className={"w-full px-3 space-y-4 mt-0"}>
          {tasks.map((task, tIndex) => (
            <Task
              tIndex={tIndex}
              cIndex={index}
              activeColumn={activeColumn}
              activeTask={activeTask}
              task={task}
              key={`task-${tIndex}`}
            />
          ))}

          {/**--------------------------------------Bottom New Task Button */}
          {showBottomButton && (
            <div className="h-[32px]">
              <div className="group scale-100 bg-opacity-20 w-full mt-[16px] bg-slate-500 py-2 rounded flex justify-center">
                <Plus className="sm:mx-0 xs:mx-2 text-white-black"  strokeWidth={1.75}/>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const SectionHeader = ({
  title,
  taskCount,
}: {
  title: string;
  taskCount: number;
}) => {
  return (
    <div className="task-detail-heading-tag bg-containerBackground px-3">
      <>
        <div className="flex items-center gap-[6px]">
          <p
            className="text-left  text-white-black"
            style={{ fontSize: "18px" }}
          >
            {title}
          </p>
          <p className="text-meta font-medium self-center text-text-light-gray mt-[2px]">
            {taskCount}
          </p>
        </div>
      </>
      <div className="group scale-100  relative group-hover/main:scale-100 ">
        <Plus className="sm:mx-0 xs:mx-2 text-white-black"  strokeWidth={1.75}/>
      </div>
    </div>
  );
};

export default Section;
