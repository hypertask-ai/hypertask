import Link from "next/link";
import React from "react";

import { ITask } from "@/models/model";
import type { DraggableProvided } from "@hello-pangea/dnd";

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

/**
 * A cheap, navigable stand-in for a card outside the large-board viewport.
 * The real card replaces it before interaction or drag dimension collection.
 */
const ProgressiveTaskPlaceholder = ({
  task,
  provided,
  onReveal,
  onOpen,
  keyboardAccessible = false,
}: ProgressiveTaskPlaceholderProps) => (
  <div
    ref={provided.innerRef}
    id={`task-${task.id}`}
    data-progressive-task-id={task.id}
    aria-label={task.title}
    className="block rounded-[5px] border border-transparent bg-cardBackground px-2 py-2 text-dense text-white-black"
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

export default React.memo(ProgressiveTaskPlaceholder);
