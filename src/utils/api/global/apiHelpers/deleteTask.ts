import { logger as htLogger } from "#logger";
import axios from "axios";

export const deleteTaskAPI = async (taskId: number) => {
  try {
    const taskDelete = await axios.post(
      `/api/queues/tasks/taskDeleteReminder`,
      {
        taskId,
      }
    );
    return taskDelete.data;
  } catch (error) {
    // Handle the error or return a default value
    htLogger.info("🚀 ~ deleteTaskAPI ~ error:", error);
    throw error;
  }
};
