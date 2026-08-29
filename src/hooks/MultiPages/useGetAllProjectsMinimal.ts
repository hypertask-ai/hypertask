import { useQuery } from "@tanstack/react-query";
import globalAPIHandlers from "@/utils/api/global";

export const useGetAllProjectsMinimal = (
  queryKey: any,
  initialData?: any,
  options?: { enabled?: boolean },
) => {
  return useQuery({
    queryKey: queryKey,
    queryFn: () => globalAPIHandlers.getAllProjectsMinimal("ExtraMinimal"),
    enabled: options?.enabled ?? true,
    initialData: initialData ?? [],
  });
};
