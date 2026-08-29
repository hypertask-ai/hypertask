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
    // This would be your existing hook that provides updateTaskInCache
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
            // Create task with removed parent relationship
            const taskToReturn = { parentTaskId: undefined, parentTask: undefined };
            // Update cache
            if (taskInfo.projectId) updateTaskInCache(
              taskToReturn,
              taskInfo.taskId,
              taskInfo.projectId,
              taskInfo.sectionId,
            );
            
            // Run additional success logic if provided
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
        /**
         * Unlinks the parent from child. Called from the child only.
         *
         * @param {Object} taskInfo - Info about the task to unlink.
         * @param {number} taskInfo.taskId - ID of the task to unlink.
         * @param {number} [taskInfo.projectId] - Optional project ID.
         * @param {number} [taskInfo.sectionId] - Optional section ID.
         * @param {RemoveParentTaskOptions} [options] - Optional settings.
         * @returns {*} Promise resolving to toast.
         */
        removeParentTask,
      };
  }