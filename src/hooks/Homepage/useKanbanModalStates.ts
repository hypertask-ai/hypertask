import { getAllSubTasks } from "@/app/[...boardURL]/serverActions";
import { ITask } from "@/models/model";
import { boardSearchAtom, currentProjectAtom } from "@/store";
import { useEffect, useState } from "react";
import { useRecoilState } from "@/lib/state";

export interface ITaskDeleteInfo {
  id: number;
  section: string;
  parentTask?: ITask;
}

const useKanbanModalStates = () => {
  const [showManageColumnsModal, setShowMoveModal] = useState<boolean>(false);
  const [showViewsModal, setShowViewsModal] = useState<boolean>(false);
  const [showManageViewsModal, setManageViewsModal] = useState<boolean>(false);
  const [currentProject] = useRecoilState(currentProjectAtom);
  const [boardSearch, setBoardSearch] = useRecoilState(boardSearchAtom);
  const showSearchTasks =
    boardSearch.open && boardSearch.projectId === currentProject?.id;
  const [showDeleteTaskModal, setShowDeleteTaskModal] =
    useState<boolean>(false);
  const [taskInfo, setTaskInfo] = useState<ITaskDeleteInfo | undefined>(
    undefined
  );
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [tasksToDelete, setTasksToDelete] = useState<number[]|undefined>([])
  const toggleSaveViewsModal = () => setShowSaveModal((prev) => !prev);

  // HTPR-6072: the board tree no longer remounts on a board switch, so these
  // modals must close explicitly instead of getting torn down for free.
  useEffect(() => {
    setShowMoveModal(false);
    setShowViewsModal(false);
    setManageViewsModal(false);
    setShowDeleteTaskModal(false);
    setTaskInfo(undefined);
    setTasksToDelete(undefined);
    setShowSaveModal(false);
  }, [currentProject?.id]);

  const toggleViewsModal = (switchToManage?: boolean) => {
    if (switchToManage) {
      setManageViewsModal(true);
      setShowViewsModal(false);
      return;
    }
    setShowViewsModal((prev) => !prev);
  };

  // Closing the search also clears the keyword so the render-time filter drops.
  const toggleSearchTasks = (val: boolean) =>
    setBoardSearch((s) => ({
      open: val,
      keyword:
        val && s.projectId === currentProject?.id ? s.keyword : "",
      projectId: val ? currentProject?.id ?? null : null,
    }));

  const toggleManageViewsModal = () => setManageViewsModal((prev) => !prev);

  const toggleDeleteModal = async (state: boolean, task?: ITaskDeleteInfo) => {
    if (state) {
        if(!task) return
        setTaskInfo(task)
        // HTPR-6072: SectionComp stays mounted across a board switch, so this
        // await can resolve after the user has already moved to another
        // board. Ignore a stale lookup instead of reopening the delete flow
        // on the wrong board.
        const lookupProjectId = currentProject?.id
        const allTasks : number[] | undefined = await getAllSubTasks(task.id)
        if (currentProject?.id !== lookupProjectId) return
        setTasksToDelete(allTasks)
        setShowDeleteTaskModal(true)
    }else{
        setShowDeleteTaskModal(false)
        setTaskInfo(undefined)
        setTasksToDelete(undefined)
    }
  };

  return {
    showSaveModal,
    toggleSaveViewsModal,
    showManageViewsModal,
    toggleManageViewsModal,
    toggleViewsModal,
    showViewsModal,
    setShowViewsModal,
    showManageColumnsModal,
    setShowManageColumnsModal: setShowMoveModal,
    showDeleteTaskModal,
    toggleDeleteModal,
    taskInfo,
    setTaskInfo,
    tasksToDelete,
    setTasksToDelete,
    showSearchTasks,
    toggleSearchTasks,
  };
};

export default useKanbanModalStates;
