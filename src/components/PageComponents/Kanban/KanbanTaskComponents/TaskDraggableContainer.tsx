import { IProject, ITask } from "@/models/model";
import Link from "next/link";
import React, { useCallback, ReactNode, useContext } from "react";
import { DraggableProvided, DraggableStateSnapshot } from "@hello-pangea/dnd";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { cn } from "@/utils/undoActions/helperFuncs";
interface ITaskDraggableContainer {
  children: ReactNode;
  selectionControl?: ReactNode;
  provided?: DraggableProvided;
  active: boolean;
  selected?: boolean;
  blocked?: boolean;
  snapshot?: DraggableStateSnapshot;
  _currentProject?: IProject;
  openDetail: () => void;
  taskHref: string;
  parentClassName?: string;
  linkClassName?: string;
}

const TaskDraggableContainer: React.FC<ITaskDraggableContainer> = ({
  children,
  selectionControl,
  taskHref,
  provided,
  active,
  selected = false,
  blocked,
  _currentProject,
  snapshot,
  openDetail,
  parentClassName,
  linkClassName,
}) => {
  const isMbl = useContext(MobileViewContext);

  const getStyle = useCallback(
    (style: any, snapshot: DraggableStateSnapshot) => {
      if (!snapshot.isDragging && _currentProject?.sorting_mode !== "Manual")
        return {};
      if (!snapshot.isDropAnimating) {
        return style;
      }

      return {
        ...style,
        transitionDuration: `0.24s`,
      };
    },
    [_currentProject?.sorting_mode]
  );

  return (
    <div
      ref={provided?.innerRef}
      className={cn(
        isMbl ? "shadow-sm" : "shadow-md",
        isMbl && snapshot?.isDragging && "shadow-md",
        blocked ? "border-l-[3px]" : "border-l-4",
        selected
          ? blocked
            ? "ring-1 ring-inset ring-hypertasks-purple border-[hsl(0_62.8%_30.6%)] bg-kanban-active-cardbg hover:bg-hover-active"
            : "ring-1 ring-inset ring-hypertasks-purple border-transparent bg-kanban-active-cardbg hover:bg-hover-active"
          : active
          ? blocked
            ? "border-[hsl(0_62.8%_30.6%)] bg-kanban-active-cardbg hover:bg-hover-active"
            : "border-white-black bg-kanban-active-cardbg hover:bg-hover-active"
          : blocked
            ? "border-[hsl(0_62.8%_30.6%)] bg-cardBackground hover:bg-hoverCardBackground hover:shadow-md"
            : "border-transparent bg-cardBackground hover:bg-hoverCardBackground hover:shadow-md",
        "kanban-task-card group/kanban-selection relative rounded-[5px] outline-none cursor-pointer",
        parentClassName
      )}
      onClick={openDetail}
      {...provided?.draggableProps}
      {...provided?.dragHandleProps}
      style={getStyle(
        provided?.draggableProps?.style,
        snapshot ??
          ({
            isDragging: false,
            isDropAnimating: false,
          } as DraggableStateSnapshot)
      )}
    >
      {selectionControl}
      <Link
        prefetch={false}
        // style={{pointerEvents:showBoardManager?"none":"auto"}}
        className={cn(`flex items-center p-2 gap-1.5 flex-wrap`, linkClassName)}
        href={taskHref}
      >
        {children}
      </Link>
    </div>
  );
};

export default TaskDraggableContainer;
