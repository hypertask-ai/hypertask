
import { getDraftsHelper } from "@/utils/api/Task Detail";
import { useHydrated } from "@/hooks/General/useHydrated";
import { useQuery } from "@tanstack/react-query";



export const useGetDrafts = (
  taskId: number,
  userId: number | undefined,
  initialData?: any
) => {
  const queryKey = ["draft for [task,userId]:", taskId, userId];
  return useQuery({
    queryKey,
    queryFn: () => getDraftsHelper(taskId, userId!),
    initialData: initialData ?? [],
    enabled: !!userId && !!taskId,
    ...(useHydrated() ? {} : { queryKey: [...queryKey, "hydrating"], enabled: false }),
  });
};
