
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
    initialData,
    initialDataUpdatedAt: initialData?.updatedAt,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled: options?.enabled ?? !!userId,
  });
};
