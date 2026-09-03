import type { ITaskDetailEditMode } from "@/lib/contexts/TaskDetail/TaskProvider";

export const shouldMountTaskDescriptionEditor = ({
  editMode,
  hasDraft,
  hasDraftInit,
}: {
  editMode: ITaskDetailEditMode;
  hasDraft: boolean;
  hasDraftInit: boolean;
}) =>
  editMode === "description" ||
  editMode === "description-ai" ||
  hasDraft ||
  hasDraftInit;
