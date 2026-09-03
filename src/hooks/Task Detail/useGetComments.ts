
import { fetchCommentsHelper } from "@/utils/api/Task Detail";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const useGetAllComments = (
  queryKey: any,
  taskId: number,
  userId: number | undefined,
  initialData?: any,
  options?: { enabled?: boolean }
) => {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey,
    queryFn: () => fetchCommentsHelper(taskId, userId!, queryClient),
    initialData: initialData ?? [],
    refetchOnWindowFocus: true,
    enabled: options?.enabled ?? !!userId,
  });
};
