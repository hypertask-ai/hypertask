
import { fetchCommentsHelper } from "@/utils/api/Task Detail";
import { useQuery } from "@tanstack/react-query";

export const useGetAllComments = (
  queryKey: any,
  taskId: number,
  userId: number | undefined,
  initialData?: any,
  options?: { enabled?: boolean }
) => {
  return useQuery({
    queryKey,
    queryFn: () => fetchCommentsHelper(taskId, userId!),
    initialData: initialData ?? [],
    refetchOnWindowFocus: true,
    enabled: options?.enabled ?? !!userId,
  });
};
