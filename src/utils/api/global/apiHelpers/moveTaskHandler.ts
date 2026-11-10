import axios from "axios";
import toast from "react-hot-toast";

let pendingMoves = 0;
export const pendingBoardMoves = () => pendingMoves;

export default async function moveTaskHandler(
  section_title: string,
  newSecId: number,
  taskId: number,
  ranking: string,
  projectId: number,
) {
  pendingMoves += 1;
  try {
    const response = await axios.put("/api/tasks/moveTask", {
      section_title: section_title,
      sectionId: newSecId,
      taskId: taskId,
      ranking: ranking,
      projectId: projectId,
    });

    return response.status >= 200 && response.status < 300;
  } catch (error: any) {
    toast.error(error?.response?.data?.message ?? "Unable to move task");
    return false;
  } finally {
    pendingMoves -= 1;
  }
}
