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
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8991_RIGHT_COLUMN_FLAG } from "@/lib/flags/definitions/htpr-8991-right-column";
import { HTPR_8997_ID_ROW_FLAG } from "@/lib/flags/definitions/htpr-8997-id-row";
import { HTPR_8992_STICKY_TITLE_FLAG } from "@/lib/flags/definitions/htpr-8992-sticky-title";
import useCopyURL from "@/hooks/General/useCopyURL";
import Tooltip from "@/components/Common/Tooltip";
import { useDeviceContext } from "@/lib/contexts/deviceContext";

interface TaskDetailTitleContainerProps {
  containerRef?: React.RefObject<HTMLDivElement | null>;
  toggleDueDate: () => void;
  clearDesktopNavigation?: boolean;
}

const TaskDetailTitleContainer = ({ containerRef, toggleDueDate, clearDesktopNavigation = false }: TaskDetailTitleContainerProps) => {
  const { currentTask, parsedTask, cachedLayout } = useTaskContext();
  const _mbl = useContext(MobileViewContext);
  const [isScrolled, setIsScrolled] = useState(false);
  const rightColumnFlag = useFlag(HTPR_8991_RIGHT_COLUMN_FLAG);
  const idRowFlag = useFlag(HTPR_8997_ID_ROW_FLAG);
  const stickyTitleLine = useFlag(HTPR_8992_STICKY_TITLE_FLAG);
  const { copyTicketNumber } = useCopyURL();
  const isApple = useDeviceContext();
  const ticketNumber = currentTask?.ticketNumber?.toUpperCase();

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      setIsScrolled(scrollTop > 0);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
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
        clearDesktopNavigation={clearDesktopNavigation}
        showScrollDivider={stickyTitleLine && isScrolled}
        hasSummary={(_mbl && cachedLayout) || hasSummary}
        titleRowContent={
          <>
            <TaskTitle />
            {rightColumnFlag && !idRowFlag && ticketNumber && (
              <span
                data-task-ticket-id
                onClick={() => void copyTicketNumber(ticketNumber)}
                className="relative group shrink-0 cursor-pointer whitespace-nowrap text-meta text-text-light-gray hover:text-white-black"
              >
                {ticketNumber}
                <Tooltip
                  portal
                  left={0}
                  bottom={-40}
                  text="Copy task ID"
                  keyCombination={[isApple ? "CMD" : "CTRL", "SHIFT", "I"]}
                />
              </span>
            )}
            <TaskOptions />
          </>
        }
      >
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