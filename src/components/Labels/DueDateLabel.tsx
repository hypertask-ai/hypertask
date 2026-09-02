import { format } from 'date-fns';
import React, { useCallback, useMemo, useState } from 'react';
import { Calendar } from "lucide-react";
import LabelWrapper from './LabelWrapper';
import Tooltip from '@/components/Common/Tooltip';

interface DueDateLabelProps {
  dueDate: Date | string;
  flexBasis?: boolean,
  fontSize?: number,
  py?: number,
  px?: number,
  onClick?: any,
  stopPropogation?: boolean,
  fontWeight?: number;
  className?: string;
  isTaskInfo?: boolean; 
  overdue?: boolean;
}

const DueDateLabel: React.FC<DueDateLabelProps> = ({ dueDate, flexBasis, fontSize, py, px, onClick, stopPropogation, fontWeight, className, isTaskInfo, overdue = false }) => {
  // dueDate is typed as Date but arrives as an ISO string from JSON responses
  // (e.g. getAll), so coerce before calling Date methods / date-fns.
  const dueDateObj = useMemo(
    () => (dueDate instanceof Date ? dueDate : new Date(dueDate)),
    [dueDate]
  );
  const dueDateTime = dueDateObj.getTime();
  const currentYear = new Date().getFullYear();
  const formattedDate = useMemo(
    () => format(dueDateObj, dueDateObj.getFullYear() === currentYear ? "LLL dd" : "LLL dd, y"),
    [currentYear, dueDateObj]
  );
  const [tooltipDate, setTooltipDate] = useState<{
    dueDateTime: number;
    text: string;
  } | null>(null);
  const resolvedTooltipDate =
    tooltipDate?.dueDateTime === dueDateTime ? tooltipDate.text : "";
  const typographyStyle = {
    ...(fontSize ? { fontSize } : {}),
    ...(fontWeight ? { fontWeight } : {}),
  };
  const dateTextStyle = {
    ...typographyStyle,
  };

  const handleOnClick = (e: any) => {
    e.preventDefault();
    stopPropogation && e.stopPropagation(); // Prevent the click event from propagating to the parent div
    onClick?.();
  }

  const handleMouseEnter = useCallback(() => {
    setTooltipDate((current) => {
      if (current?.dueDateTime === dueDateTime) return current;
      return {
        dueDateTime,
        text: format(dueDateObj, "EEEE, LLLL dd, yyyy 'at' h:mm a"),
      };
    });
  }, [dueDateObj, dueDateTime]);


  return (
    <LabelWrapper
      onClick={handleOnClick}
      onMouseEnter={handleMouseEnter}
      flexBasis={flexBasis}
      className={`relative group ${className || ''}`}
      py={py}
      px={px}
      style={typographyStyle}
    >
      <Calendar className={overdue ? "text-[#F16A6A]" : "text-[#FB773F]"} fontSize={16} size={16} strokeWidth={1.75} />
      <span
        className='whitespace-nowrap'
        onClick={handleOnClick}
        style={dateTextStyle}
        suppressHydrationWarning
      >
        {formattedDate}
      </span>
      {resolvedTooltipDate ? (
        <Tooltip
          left={0}
          bottom={isTaskInfo ? -80 : -40}
          text={resolvedTooltipDate}
          keyCombination={[]}
        />
      ) : null}
    </LabelWrapper>
  );
};

export default DueDateLabel;
