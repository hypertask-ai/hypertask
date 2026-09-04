import axios from "axios";

export async function markTaskSeen(
  taskId: number,
  commentIds: Array<number | string>
) {
  if (commentIds.length > 0) {
    await axios.post("/api/comments/updateSeen", { commentIds, taskId });
    return;
  }

  await axios.post("/api/notifications/getByTask", { taskId });
}
