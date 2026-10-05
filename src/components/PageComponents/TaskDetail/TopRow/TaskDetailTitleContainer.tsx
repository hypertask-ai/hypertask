import React, { useState, useEffect } from 'react'
import { useTaskContext } from '@/lib/contexts/TaskDetail/TaskProvider';
import TaskOptions from '../TaskOptions/TaskOptions';
import TaskTitle from './TaskTitle';
import TaskSummary from './TaskSummary';
import { TaskSummaryMobile } from '@/components/Modals/Sheets/SummarySheet';
import SubTaskLink from './SubtaskLink';
import BaseTitleContainer from './BaseTitleContainer';
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";
import MobileTaskDueDate from "./MobileTaskDueDate";

interface TaskDetailTitleContainerProps {
  containerRef?: React.RefObject<HTMLDivElement | null>;
  toggleDueDate: () => void;
}

const TaskDetailTitleContainer = ({ containerRef, toggleDueDate }: TaskDetailTitleContainerProps) => {
  const { currentTask, parsedTask, cachedLayout } = useTaskContext();
  const _mbl = useContext(MobileViewContext);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      setIsScrolled(scrollTop > 0);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    // Check initial scroll position
    handleScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const hasSummary = !!currentTask?.Task_Summary?.[0]?.content;
  const summary = hasSummary && currentTask?.Task_Summary?.[0]?.content && (
    _mbl ? (
      <TaskSummaryMobile markdown={currentTask.Task_Summary[0].content} />
    ) : (
      <TaskSummary taskSummary={currentTask.Task_Summary[0].content} />
    )
  );

  return (
    <>
      <BaseTitleContainer
        dataAttribute="task-detail"
        containerRef={containerRef}
        showScrollShadow={isScrolled}
        hasSummary={(_mbl && cachedLayout) || hasSummary}
        titleRowContent={
          <>
            <TaskTitle />
            <TaskOptions />
          </>
        }
      >
        {/* --------------------------- TASK SUMMARY --------------------------- */}
        {/* Mobile reserves its summary slot; desktop must not add space for an absent summary. */}
        {cachedLayout && (_mbl || hasSummary) ? (
          <div data-task-summary-slot className={_mbl ? "h-10 w-full shrink-0" : "h-[21px] w-full shrink-0"}>
            {summary}
          </div>
        ) : summary}

        <MobileTaskDueDate
          dueDate={currentTask?.dueDate}
          isMobile={_mbl}
          onClick={toggleDueDate}
        />

        {/* --------------------------- PARENT TASK INFO ------------------------------ */}
        {
          !_mbl && <SubTaskLink parentTask={currentTask?.parentTask} projectId={currentTask?.projectId} />
        }
      </BaseTitleContainer>
      {
          _mbl && <SubTaskLink parentTask={currentTask?.parentTask} projectId={currentTask?.projectId} className='task-detail-horizontal-padding' />
        }
    </>
  )
}

export default TaskDetailTitleContainer