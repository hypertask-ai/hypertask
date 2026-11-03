import Link from "next/link";
import React from "react";

import { ITask } from "@/models/model";
import type { DraggableProvided } from "@hello-pangea/dnd";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8255_KANBAN_CLEANUP_FLAG } from "@/lib/flags/definitions/htpr-8255-kanban-cleanup";

type ProgressiveTaskPlaceholderProps = {
  task: ITask;
  provided: DraggableProvided;
  onReveal: (taskId: number, restoreFocus?: boolean) => void;
  onOpen: (task: ITask) => void;
  keyboardAccessible?: boolean;
};

const estimatedTaskHeight = (task: ITask) => {
  const hasMetadata = Boolean(
    task.dueDate ||
      task.estimate ||
      task.priority ||
      task.taskLabels?.length ||
      task.assignees?.length,
  );
  const subtaskRows = Math.min(task.subTasks?.length ?? 0, 3);
  return 76 + (hasMetadata ? 28 : 0) + subtaskRows * 24;
};

const ProgressiveTaskPlaceholder = ({
  task,
  provided,
  onReveal,
  onOpen,
  keyboardAccessible = false,
}: ProgressiveTaskPlaceholderProps) => {
  const cleanup = useFlag(HTPR_8255_KANBAN_CLEANUP_FLAG);
  return (
  <div
    ref={provided.innerRef}
    id={`task-${task.id}`}
    data-progressive-task-id={task.id}
    aria-label={task.title}
    className={`block border-thin border-transparent bg-cardBackground py-2 text-dense text-white-black ${
      cleanup ? "rounded-md pl-3 pr-2" : "rounded-[5px] px-2"
    }`}
    {...provided.draggableProps}
    {...provided.dragHandleProps}
    style={{
      minHeight: estimatedTaskHeight(task),
      ...provided.draggableProps.style,
    }}
    onFocus={(event) => {
      if (event.currentTarget.matches(":focus-visible")) {
        onReveal(task.id, true);
      }
    }}
  >
    <Link
      href={`/detail/project-${task.projectId}/${task.uniqueIndex}`}
      prefetch={false}
      tabIndex={keyboardAccessible ? 0 : -1}
      className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      onKeyDown={(event) => {
        if (!keyboardAccessible || event.key !== " ") return;
        event.preventDefault();
        onOpen(task);
      }}
      onClick={(event) => {
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        onOpen(task);
      }}
    >
      {task.title}
    </Link>
  </div>
  );
};

export default React.memo(ProgressiveTaskPlaceholder);
