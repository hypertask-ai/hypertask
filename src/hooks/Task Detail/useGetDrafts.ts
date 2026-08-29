
import { getDraftsHelper } from "@/utils/api/Task Detail";
import { useQuery } from "@tanstack/react-query";



export const useGetDrafts = (
  taskId: number,
  userId: number | undefined,
  initialData?: any
) => {
  return useQuery({
    queryKey: ["draft for [task,userId]:", taskId, userId],
    queryFn: () => getDraftsHelper(taskId, userId!),
    initialData: initialData ?? [],
    enabled: !!userId && !!taskId,
  });
};
