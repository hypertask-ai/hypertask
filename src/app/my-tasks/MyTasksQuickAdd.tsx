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
import { MY_TASKS_QUICK_ADD_DEFAULT_BOARD_KEY } from "@/lib/myTasks/quickAddHelpers";
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
    viewId: number | null,
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
  const { data: projects = [], isFetched: projectsFetched } =
    useGetAllProjectsMinimal(["my-tasks-quick-add-projects"], []);

  const sessionDefaultBoardId = (() => {
    if (typeof window === "undefined") return null;
    if (activeViewId !== null) return null;
    if (viewConfig.defaultBoardId != null) return null;
    try {
      const raw = localStorage.getItem(
        `${MY_TASKS_QUICK_ADD_DEFAULT_BOARD_KEY}:${currentUser.id}`,
      );
      const parsed = Number(raw);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    } catch {
      return null;
    }
  })();

  const resolvedBoardId = resolveMyTasksQuickAddBoardId(
    viewConfig.defaultBoardId ?? sessionDefaultBoardId,
    accessibleProjectIds,
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
        resolveMyTasksQuickAddBoardId(
          viewConfig.defaultBoardId,
          accessibleProjectIds,
        ) !== project.id
      ) {
        try {
          await onPersistDefaultBoard(viewId, project.id);
        } catch (error) {
          toast.error("Task created, but the default board was not saved");
        }
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
      accessibleProjectIds,
      currentUser,
      onPersistDefaultBoard,
      onRefresh,
      scopes,
      viewConfig.defaultBoardId,
    ],
  );

  const openBoardPicker = (taskTitle: string) => {
    pendingTitleRef.current = taskTitle;
    pendingViewIdRef.current = activeViewId;
    setBoardPickerOpen(true);
  };

  const invokeCreateItem = useCallback(
    async (nextTitle: string) => {
      const trimmed = nextTitle.trim();
      if (!trimmed) return false;

      if (resolvedBoardId === null) {
        openBoardPicker(trimmed);
        return true;
      }

      if (!projectsFetched) {
        toast("Loading boards…");
        return false;
      }

      const project = (projects as IProject[]).find(
        (entry) => entry.id === resolvedBoardId,
      );
      if (!project) {
        openBoardPicker(trimmed);
        return true;
      }

      try {
        return await createOnBoard(project, trimmed, activeViewId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not create the task";
        const needsNewBoard =
          /forbidden|403|no active section|could not load a column/i.test(
            message,
          );
        if (needsNewBoard) {
          openBoardPicker(trimmed);
          return true;
        }
        toast.error(message);
        return false;
      }
    },
    [
      activeViewId,
      createOnBoard,
      projects,
      projectsFetched,
      resolvedBoardId,
    ],
  );

  const onPickBoard = async (project?: IProject) => {
    setBoardPickerOpen(false);
    const pendingTitle = pendingTitleRef.current;
    const pendingViewId = pendingViewIdRef.current;
    pendingTitleRef.current = null;
    pendingViewIdRef.current = null;
    if (!project) {
      if (pendingTitle) setTitle(pendingTitle);
      return;
    }
    if (!pendingTitle) return;
    try {
      await createOnBoard(project, pendingTitle, pendingViewId);
      setTitle("");
    } catch (error) {
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
      <p
        className="mb-1 text-content text-text-light-gray"
        data-htpr-6460-quick-add-label=""
      >
        Quick add a task
      </p>
      <NewTask
        title={title}
        onTitleChange={setTitle}
        inputRef={inputRef}
        onCancelCreate={() => setTitle("")}
        invokeCreateItem={invokeCreateItem}
      />
      {boardPickerOpen ? (
        <SetProjectsModal toggle={onPickBoard} allProjects={pickerProjects} />
      ) : null}
    </div>
  );
};

export default MyTasksQuickAdd;
