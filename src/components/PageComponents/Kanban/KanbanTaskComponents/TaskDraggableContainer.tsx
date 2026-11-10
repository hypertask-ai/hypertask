import { IProject, ITask } from "@/models/model";
import Link from "next/link";
import React, { useCallback, ReactNode, useContext } from "react";
import { DraggableProvided, DraggableStateSnapshot } from "@hello-pangea/dnd";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { cn } from "@/utils/undoActions/helperFuncs";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7614_SELECTED_CARD_BORDER_FLAG } from "@/lib/flags/keys";
import { HTPR_8255_KANBAN_CLEANUP_FLAG } from "@/lib/flags/definitions/htpr-8255-kanban-cleanup";
interface ITaskDraggableContainer {
  children: ReactNode;
  selectionControl?: ReactNode;
  provided?: DraggableProvided;
  active: boolean;
  selected?: boolean;
  selectionMode?: boolean;
  onSelectToggle?: (event: React.MouseEvent<HTMLElement>) => void;
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
  selectionMode = false,
  onSelectToggle,
  blocked,
  _currentProject,
  snapshot,
  openDetail,
  parentClassName,
  linkClassName,
}) => {
  const isMbl = useContext(MobileViewContext);
  const selectedCardBorder = useFlag(HTPR_7614_SELECTED_CARD_BORDER_FLAG);
  const cleanup = useFlag(HTPR_8255_KANBAN_CLEANUP_FLAG);
  const selectionLine = selectedCardBorder
    ? "!outline-solid !outline-1 !-outline-offset-1 !outline-hypertasks-purple"
    : "ring-1 ring-inset ring-hypertasks-purple";
  const cardState = selected
    ? blocked
      ? "selected-blocked"
      : "selected"
    : active
      ? blocked
        ? "active-blocked"
        : "active"
      : blocked
        ? "blocked"
        : "plain";
  const legacyStroke = blocked ? "border-l-[3px]" : "border-l-4";
  const selectedKeepsLayout = Boolean(onSelectToggle) && active && !blocked;
  const cleanupStroke = {
    "selected-blocked": "border-l-4 border-[hsl(0_62.8%_30.6%)]",
    selected: selectedKeepsLayout ? "border-l-4 border-transparent" : "border-l-0",
    "active-blocked": "border-l-4 border-[hsl(0_62.8%_30.6%)]",
    active: "border-l-4 border-white-black",
    blocked: "border-l-4 border-[hsl(0_62.8%_30.6%)]",
    plain: "border-l-0",
  }[cardState];
  const cardStateClasses = {
    "selected-blocked": `${selectionLine} border-[hsl(0_62.8%_30.6%)] bg-kanban-active-cardbg hover:bg-hover-active`,
    selected: `${selectionLine} border-transparent bg-kanban-active-cardbg hover:bg-hover-active`,
    "active-blocked": "border-[hsl(0_62.8%_30.6%)] bg-kanban-active-cardbg hover:bg-hover-active",
    active: "border-white-black bg-kanban-active-cardbg hover:bg-hover-active",
    blocked: "border-[hsl(0_62.8%_30.6%)] bg-cardBackground hover:bg-hoverCardBackground hover:shadow-md",
    plain: "border-transparent bg-cardBackground hover:bg-hoverCardBackground hover:shadow-md",
  }[cardState];
  const cleanupStateClasses = {
    "selected-blocked": `${selectionLine} bg-kanban-active-cardbg hover:bg-hover-active`,
    selected: `${selectionLine} bg-kanban-active-cardbg hover:bg-hover-active`,
    "active-blocked": "bg-kanban-active-cardbg hover:bg-hover-active",
    active: "bg-kanban-active-cardbg hover:bg-hover-active",
    blocked: "bg-cardBackground hover:bg-hoverCardBackground",
    plain: "bg-cardBackground hover:bg-hoverCardBackground",
  }[cardState];
  const stroked =
    cardState === "blocked" ||
    cardState === "active" ||
    cardState === "active-blocked" ||
    cardState === "selected-blocked" ||
    (cardState === "selected" && selectedKeepsLayout);
  const cardBody =
    "kanban-task-card group/kanban-selection relative min-w-0 max-w-full rounded-[5px] outline-none cursor-pointer";

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
        cleanup ? cleanupStroke : legacyStroke,
        cleanup ? cleanupStateClasses : cardStateClasses,
        cardBody,
        parentClassName
      )}
      onClick={(event) =>
        onSelectToggle && (event.shiftKey || selectionMode)
          ? onSelectToggle(event)
          : openDetail()
      }
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
        className={cn(
          cleanup
            ? `flex min-w-0 w-full max-w-full items-center gap-1.5 flex-wrap overflow-hidden ${stroked ? "p-2" : "py-2 pr-2 pl-3"}`
            : "flex min-w-0 w-full max-w-full items-center p-2 gap-1.5 flex-wrap overflow-hidden",
          linkClassName
        )}
        href={taskHref}
        onClick={(event) => {
          const shiftSelects =
            onSelectToggle && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.button === 0;
          if (shiftSelects) {
            event.preventDefault();
            return;
          }
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
            event.stopPropagation();
            return;
          }
          event.preventDefault();
        }}
      >
        {children}
      </Link>
    </div>
  );
};

export default TaskDraggableContainer;
