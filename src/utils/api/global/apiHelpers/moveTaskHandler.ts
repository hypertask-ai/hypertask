import axios from "axios";

export default async function moveTaskHandler(
  section_title: string,
  newSecId: number,
  taskId: number,
  ranking: string,
  projectId: number,
) {
  const response = await axios.put("/api/tasks/moveTask", {
    section_title: section_title,
    sectionId: newSecId,
    taskId: taskId,
    ranking: ranking,
    projectId: projectId,
  });

  return response.status >= 200 && response.status < 300;
}
