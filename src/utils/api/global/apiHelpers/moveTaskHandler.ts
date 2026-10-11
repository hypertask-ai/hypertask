import axios from "axios";

// Board drags write here outside react-query, so isMutating() cannot see them.
// The board reload after a cancelled load (HTPR-7129) waits while any is pending.
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
  } finally {
    pendingMoves -= 1;
  }
}
