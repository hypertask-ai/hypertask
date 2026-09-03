import { getTaskShareLink } from "@/utils/api/Task Detail";
import { useQuery } from "@tanstack/react-query";

const MINUTE = 1000 * 60;
export const useGetTaskShareLinks = (
  taskId: number,
  projectId: number,
  userId: number,
  initialData?: any,
  enabled = true
) => {
  return useQuery({
    queryKey: ["task-share-links", taskId, userId, projectId],
    queryFn: () => getTaskShareLink(taskId, projectId, userId),
    gcTime: 60 * MINUTE,
    refetchOnMount: true,
    enabled,
  });
};
