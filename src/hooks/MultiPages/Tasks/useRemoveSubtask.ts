import { removeParentTaskRoute } from "@/lib/constants/APIRouteConstants";
import axios from "axios";
import toast from "react-hot-toast";
import UpdateKanban from "../useUpdateTaskInBoards";
import { useCallback } from "react";


  interface RemoveParentTaskOptions {
    onSuccess?: (response?: any) => void;
    loadingMessage?: string;
    successMessage?: string;
    errorMessage?: string;
    onError?: (response?: any) => void;
  }
  
  export function useRemoveParentTask() {
    const { updateTaskInCache } = UpdateKanban();

    const removeParentTask = (
      taskInfo:{
        taskId:number,
        projectId?:number
        sectionId?:number
      },
      options?: RemoveParentTaskOptions
    ) => {
      const {
        onSuccess,
        loadingMessage = "Unlinking from parent task",
        successMessage = "Task has been unlinked from its parent",
        errorMessage = "Error unlinking parent task",
        onError
      } = options || {};
      
      return toast.promise(
        axios.post(removeParentTaskRoute, { childId:taskInfo.taskId }),
        {
          loading: loadingMessage,
          success: (response) => {
            const taskToReturn = { parentTaskId: undefined, parentTask: undefined };
            if (taskInfo.projectId) updateTaskInCache(
              taskToReturn,
              taskInfo.taskId,
              taskInfo.projectId,
              taskInfo.sectionId,
            );
            
            if (onSuccess) {
              onSuccess(response?.data);
            }
            
            return successMessage;
          },
          error: (error) => {
            console.log("🚀 ~ removeParentTask ~ error:", error);
            onError&&onError()
            return errorMessage;
          },
        }
      );
    }
    
    return {
        removeParentTask,
      };
  }