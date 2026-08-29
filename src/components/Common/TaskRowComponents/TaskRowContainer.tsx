import { cn } from '@/utils/undoActions/helperFuncs';
import React, { RefObject, ReactNode } from 'react';

// Define a generic interface for the props
interface TaskRowContainerProps<T> {
children: ReactNode;
  divId: string|number; // The item can be of any type
 openTask: () => void; // Function to open the task
 handleMouseLeave?: () => void; // Function to handle mouse leave
 handleMouseEnter?: (index: number) => void; // Function to handle mouse enter
 taskRef?: RefObject<HTMLDivElement | null>; // Ref for the task row
 selected: boolean; // Whether the task row is selected
 index: number; // Index of the task row
 divType:"inbox"|"trash",
 className?:string
}

// Define the TaskRowContainer component with the generic props
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
      {/* Content of the task row */}
      {children}
    </div>
 );
};

export default TaskRowContainer;
