import React from "react";
import { ITask } from "@/models/model";

const ParentSubTaskLabel = ({
  subTasks,
  flexBasis,
  fontSize,
  py,
  px,
  fontWeight,
  stopPropogation,
}: {
  subTasks: ITask[];
  flexBasis?: boolean;
  fontSize?: number;
  py?: number;
  px?: number;
  fontWeight?: number;
  stopPropogation?: boolean;
}) => {
  const handleOnClick = (e: any) => {
    e.preventDefault();
    stopPropogation && e.stopPropagation(); // Prevent the click event from propagating to the parent div
    //onClick && onClick();
  };

  return (
    <div
      className={`flex flex-col gap-1  
    h-fit items-start
        border-[1px] bg-inherit border-border-labelComponent rounded-sm
        px-[${px ? px : 6}px] 
        py-[${py ? py : 1}px]
        text-label-component
    ${flexBasis ? "basis-full" : ""}`}
    >
      {subTasks.map((task: ITask, index: number) => (
        <span
          key={`sub-task-tag-${task.id}-${index}`}
          style={{
            fontSize: fontSize ? fontSize : 12,
            fontWeight: fontWeight ? fontWeight : 600,
          }}
          className="line-clamp-1"
        >
          {task.ticketNumber}:&nbsp;{task.title}
        </span>
      ))}
    </div>
  );
};

export default React.memo(ParentSubTaskLabel);
