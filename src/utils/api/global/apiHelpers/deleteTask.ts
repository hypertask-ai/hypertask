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
    console.log("🚀 ~ deleteTaskAPI ~ error:", error);
    throw error;
  }
};
