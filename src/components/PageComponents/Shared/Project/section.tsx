import useSections from "@/hooks/Homepage/useSections";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { IProject, ISection, ITask } from "@/models/model";
import { useContext } from "react";
import { ReadOnlyTask } from "./task";

export const ReadOnlySection = ({
  section,
  index,
  active,
  currentProject,
}: {
  section: ISection;
  active: boolean;
  currentProject: IProject;
  index: number;
}) => {
  const isMbl = useContext(MobileViewContext);

  const { sectionRef } = useSections({
    active,
    items: section.items,
    index,
    title: section.section_title,
    sectionId: section.sectionId!,
    projectId: currentProject?.id!,
  });

  return (
    <div
      ref={sectionRef}
      // tabIndex={-1}
      className={`
          ${
            isMbl
              ? "min-w-[300px]  pb-4"
              : " border-[1px] border-pageBackground group/main focus:border-[1px] focus:border-white-black mobileResponsive md:w-full flex flex-col items-start h-auto "
          }
            focus:outline-none  bg-containerBackground shadow-md rounded-md
            max-h-inherit section-container relative
            `}
    >
      <div
        id={`droppable-section-container-${section.sectionId}`}
        style={{ scrollBehavior: "unset" }}
        data-title={section.section_title}
        className={`
          ${isMbl ? "" : "overflow-y-auto "}
          w-full sm:pb-20 h-full  max-h-inherit 
          scrollbar-thin 
          hover:scrollbar-thumb-gray-500 
          scrollbar-thumb-gray-500
          scrollbar-track-kanban-column-scrollbar dark:scrollbar-thumb-[#4F5766]
          `}
      >
        <div className="task-detail-heading-tag bg-containerBackground px-2 py-2">
          <div className="flex items-center gap-[6px] cursor-default">
            <p
              className="text-left text-white-black"
              style={{ fontSize: "13px" }}
            >
              {section.section_title}
            </p>
            <p className="text-meta font-medium self-center text-text-light-gray mt-[2px]">
              {section.items.length > 0 ? section.items.length : null}
            </p>
          </div>
        </div>
        <div
          id={`tasks-list-${index}`}
          className={`
            ${isMbl ? " scrollbar-thin  overflow-y-auto max-h-[92%]" : ""}
            "w-full px-2 space-y-4 mt-0"`}
        >
          {section.items.map((task: ITask, i: number) => {
            return (
              <ReadOnlyTask
                key={`task-${i}-${task.title}`}
                task={task}
                currentSetting={"Flattened"}
                project={currentProject}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
