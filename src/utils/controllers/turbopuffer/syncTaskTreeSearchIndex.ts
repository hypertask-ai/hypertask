import {
  deleteTasksFromTurbopuffer,
  upsertTasksToTurbopuffer,
} from "./turbopufferHelper";

export async function syncTaskTreeSearchIndex(
  taskIds: number[],
  status: "Deleted" | "Normal"
) {
  if (taskIds.length === 0) return;

  try {
    if (status === "Deleted") {
      await deleteTasksFromTurbopuffer(taskIds);
      return;
    }
    await upsertTasksToTurbopuffer(taskIds);
  } catch (error) {
    console.log("search index sync after trash or restore failed:", error);
  }
}
