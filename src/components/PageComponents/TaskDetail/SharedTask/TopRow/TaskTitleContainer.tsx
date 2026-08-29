import React from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { useContext } from "react";
import CopyTaskButton from "../../TaskOptions/CopyTaskButton";
import SharedTaskTitle from "./TaskTitle";
import TaskSummary from "../../TopRow/TaskSummary";
import { TaskSummaryMobile } from "@/components/Modals/Sheets/SummarySheet";
import BaseTitleContainer from "../../TopRow/BaseTitleContainer";

interface SharedTaskTitleContainerProps {
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

const SharedTaskTitleContainer = ({ containerRef }: SharedTaskTitleContainerProps) => {
  const { currentTask } = useTaskContext();
  const _mbl = useContext(MobileViewContext);

  const hasSummary = !!currentTask?.Task_Summary?.[0]?.content;

  return (
    <BaseTitleContainer
      dataAttribute="shared-task"
      containerRef={containerRef}
      hasSummary={hasSummary}
      titleRowClassName=""
      titleRowContent={
        <>
          <SharedTaskTitle />
          <div className="flex items-center gap-2">
            <CopyTaskButton
              title={currentTask?.title!}
              ticketNumber={currentTask?.ticketNumber!}
              uniqueId={currentTask?.uniqueIndex}
              projectId={currentTask?.projectId}
            />
          </div>
        </>
      }
    >
      {/* --------------------------- TASK SUMMARY --------------------------- */}
      {hasSummary && (
        _mbl ? (
          <TaskSummaryMobile markdown={currentTask?.Task_Summary?.[0]?.content ?? ""} />
        ) : (
          <TaskSummary taskSummary={currentTask?.Task_Summary?.[0]?.content ?? ""} />
        )
      )}

      {/* --------------------------- PARENT TASK INFO ------------------------------ */}
      {currentTask?.parentTask && (
        <span className="mt-2 px-2 pb-0 text-icon-dark-gray text-dense">
          Sub-task of&nbsp;
          <span className="text-hypertasks-header-blue font-medium hover:underline cursor-pointer">
            {currentTask?.parentTask?.ticketNumber}&nbsp;
            {currentTask?.parentTask?.title}
          </span>
        </span>
      )}
    </BaseTitleContainer>
  );
};

export default SharedTaskTitleContainer;
