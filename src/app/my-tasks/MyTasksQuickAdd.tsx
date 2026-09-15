"use client";

import NewTask from "@/components/Common/newTask";
import SetProjectsModal from "@/components/Modals/SetProjectModal/SetProjectModal";
import { useGetAllProjectsMinimal } from "@/hooks/MultiPages/useGetAllProjectsMinimal";
import {
  createMyTasksQuickAddTask,
  fetchMyTasksQuickAddSectionDefaults,
  myTasksQuickAddLikelyVisible,
  resolveMyTasksQuickAddBoardId,
} from "@/lib/myTasks/quickAdd";
import type { MyTasksScope } from "@/lib/myTasksScopes";
import type { MyTasksViewConfig } from "@/models/MyTasksView";
import type { IProject, IUser } from "@/models/model";
import { useCallback, useRef, useState } from "react";
import toast from "react-hot-toast";

type Props = {
  currentUser: IUser;
  activeViewId: number | null;
  viewConfig: MyTasksViewConfig;
  scopes: readonly MyTasksScope[];
  accessibleProjectIds: readonly number[];
  onPersistDefaultBoard: (
    viewId: number,
    defaultBoardId: number,
  ) => Promise<void>;
  /** Returns true when the created task id is present after refresh. */
  onRefresh: (taskId: number) => Promise<boolean>;
};

const MyTasksQuickAdd = ({
  currentUser,
  activeViewId,
  viewConfig,
  scopes,
  accessibleProjectIds,
  onPersistDefaultBoard,
  onRefresh,
}: Props) => {
  const [title, setTitle] = useState("");
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingTitleRef = useRef<string | null>(null);
  const pendingViewIdRef = useRef<number | null>(null);
  const { data: projects = [] } = useGetAllProjectsMinimal(
    ["my-tasks-quick-add-projects"],
    [],
  );

  const writableBoardIds = accessibleProjectIds;
  const resolvedBoardId = resolveMyTasksQuickAddBoardId(
    viewConfig.defaultBoardId,
    writableBoardIds,
  );

  const createOnBoard = useCallback(
    async (project: IProject, taskTitle: string, viewId: number | null) => {
      const section = await fetchMyTasksQuickAddSectionDefaults(project.id);
      const created = await createMyTasksQuickAddTask({
        title: taskTitle,
        project,
        currentUser,
        section,
      });
      if (
        viewId != null &&
        resolveMyTasksQuickAddBoardId(viewConfig.defaultBoardId, writableBoardIds) !==
          project.id
      ) {
        await onPersistDefaultBoard(viewId, project.id);
      }
      const found = await onRefresh(created.id);
      if (!found && !myTasksQuickAddLikelyVisible(scopes)) {
        toast("Task created. This view's filter hides it.");
      } else if (!found) {
        toast("Task created. Refresh if it does not show yet.");
      }
      return true;
    },
    [
      currentUser,
      onPersistDefaultBoard,
      onRefresh,
      scopes,
      viewConfig.defaultBoardId,
      writableBoardIds,
    ],
  );

  const invokeCreateItem = useCallback(
    async (nextTitle: string) => {
      const trimmed = nextTitle.trim();
      if (!trimmed) return false;

      if (resolvedBoardId == null) {
        pendingTitleRef.current = trimmed;
        pendingViewIdRef.current = activeViewId;
        setBoardPickerOpen(true);
        return true;
      }

      const project =
        (projects as IProject[]).find((entry) => entry.id === resolvedBoardId) ??
        ({
          id: resolvedBoardId,
          uniqueIdentifier: "TASK",
        } as IProject);

      try {
        return await createOnBoard(project, trimmed, activeViewId);
      } catch (error) {
        console.error(error);
        // Stale default board (left board / no write access): ask again.
        pendingTitleRef.current = trimmed;
        pendingViewIdRef.current = activeViewId;
        setBoardPickerOpen(true);
        return true;
      }
    },
    [activeViewId, createOnBoard, projects, resolvedBoardId],
  );

  const onPickBoard = async (project?: IProject) => {
    setBoardPickerOpen(false);
    const pendingTitle = pendingTitleRef.current;
    const pendingViewId = pendingViewIdRef.current;
    pendingTitleRef.current = null;
    pendingViewIdRef.current = null;
    if (!project || !pendingTitle) return;
    try {
      await createOnBoard(project, pendingTitle, pendingViewId);
      setTitle("");
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Could not create the task",
      );
      setTitle(pendingTitle);
    }
  };

  const writableIds = new Set(accessibleProjectIds);
  const pickerProjects = (projects as IProject[]).filter(
    (project) => writableIds.size === 0 || writableIds.has(project.id),
  );

  return (
    <div className="mb-2 px-1 @md:px-[78px] @lg:px-[73px]">
      <NewTask
        title={title}
        onTitleChange={setTitle}
        inputRef={inputRef}
        onCancelCreate={() => setTitle("")}
        invokeCreateItem={invokeCreateItem}
      />
      {boardPickerOpen ? (
        <SetProjectsModal
          toggle={onPickBoard}
          allProjects={pickerProjects}
        />
      ) : null}
    </div>
  );
};

export default MyTasksQuickAdd;
