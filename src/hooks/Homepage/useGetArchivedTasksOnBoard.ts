import { ITask } from "@/models/model";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export const archivedTasksOnBoardQueryKey = (projectId?: number) =>
  ["archivedTasks", projectId] as const;

const getArchivedTasksOnBoard = async (projectId: number) => {
  const response = await axios.get(
    `/api/tasks/getArchivedTasksByProject?projectId=${projectId}`
  );
  return response.data;
};

export const useGetArchivedTasksOnBoard = (
  projectId: number | undefined,
  enabled: boolean
) => {
  return useQuery<ITask[]>({
    queryKey: archivedTasksOnBoardQueryKey(projectId),
    queryFn: () => getArchivedTasksOnBoard(projectId!),
    enabled: enabled && !!projectId,
    refetchOnWindowFocus: false,
  });
};
