import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { ITask } from "@/models/model";
import { newTaskCreatedAtom } from "@/store";
import { useEffect } from "react";
import { useRecoilState } from "@/lib/state";
import { useRemoveParentTask } from "../MultiPages/Tasks";

const useUpdateSubtask = () => {
  const [newTaskCreated, setNewTaskCreated] =
    useRecoilState(newTaskCreatedAtom);
  const { setCurrentTask, currentTask } = useTaskContext();
  const {removeParentTask} = useRemoveParentTask()
  const callBackHandlerSubtaskLinking = (task: ITask) => {
    setCurrentTask((prev) => {
      if (!prev) return null;
      const newSubTasks = prev?.subTasks
        ? [...prev.subTasks, task].sort(
            (a, b) =>
              new Date(a.createdAt!).getTime() -
              new Date(b.createdAt!).getTime()
          )
        : [task];
      return {
        ...prev,
        subTasks: newSubTasks,
      };
    });

    scrollToDescription();
  };

  const callBackHandlerRemoveSubtask = (task: ITask) => {
    setCurrentTask((prev) => {
      if (!prev) return null;
      const newSubTasks = prev?.subTasks.filter((item) => item.id !== task.id);
      return {
        ...prev,
        subTasks: newSubTasks,
      };
    });

    scrollToDescription();
  };

  const scrollToDescription = () =>
    document?.getElementById("description")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

  const callBackHandlerRemoveParent = () => {
    if (!currentTask)return
    removeParentTask(
      {
        taskId:currentTask.id,
        projectId:currentTask.projectId,
        sectionId:currentTask.sectionId
      },
      {
        onSuccess() {
          setCurrentTask((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              parentTask: undefined,
              parentTaskId: undefined,
            };
          });
        },
      }
    )
    // toast.promise(
    //   axios.post(removeParentTaskRoute, {
    //     childId: currentTask?.id,
    //     parentId: currentTask?.parentTaskId,
    //   }),
    //   {
    //     loading: "Removing parent task",
    //     success: () => {
    //       setCurrentTask((prev) => {
    //         if (!prev) return null;
    //         return {
    //           ...prev,
    //           parentTask: undefined,
    //           parentTaskId: undefined,
    //         };
    //       });
    //       return `Parent task has been removed`;
    //     },
    //     error: (error) => {
    //       console.log("🚀 ~ toast.promise ~ error:", error);
    //       return "Error removing parent task";
    //     },
    //   }
    // );

    scrollToDescription();
  };

  // --------------- update subtasks
  useEffect(() => {
    if (
      newTaskCreated &&
      newTaskCreated.parentTask &&
      newTaskCreated.parentTaskId === currentTask?.id
    ) {
      callBackHandlerSubtaskLinking(newTaskCreated);
    }
    setNewTaskCreated(undefined);
  }, [newTaskCreated]);

  return {
    callBackHandlerSubtaskLinking,
    callBackHandlerRemoveSubtask,
    callBackHandlerRemoveParent,
  };
};

export default useUpdateSubtask;
