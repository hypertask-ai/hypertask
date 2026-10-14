import { cn } from '@/utils/undoActions/helperFuncs';
import React, { RefObject, ReactNode } from 'react';

interface TaskRowContainerProps<T> {
children: ReactNode;
  divId: string|number;
 openTask: () => void;
 handleMouseLeave?: () => void;
 handleMouseEnter?: (index: number) => void;
 taskRef?: RefObject<HTMLDivElement | null>;
 selected: boolean;
 index: number;
 divType:"inbox"|"trash",
 className?:string
}

const TaskRowContainer = <T,>({
children,
 divId,
 openTask,
 handleMouseLeave,
 handleMouseEnter,
 taskRef,
 selected,
 index,
 className,
 divType,
}: TaskRowContainerProps<T>) => {

const defaultClassName = ""
return (

    <div
      id={`${divType}-${divId}`}
      onClick={openTask}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={() => handleMouseEnter && handleMouseEnter(index)}
      ref={taskRef}
      suppressContentEditableWarning
      key={index}
      className={cn(defaultClassName, className)}
    >
      {children}
    </div>
 );
};

export default TaskRowContainer;
