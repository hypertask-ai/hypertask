import { useQuery } from "@tanstack/react-query";
import globalAPIHandlers from "@/utils/api/global";
import { useHydrated } from "@/hooks/General/useHydrated";

export const useGetAllProjectsMinimal = (
  queryKey: any,
  initialData?: any,
  options?: { enabled?: boolean },
) => {
  return useQuery({
    queryKey: queryKey,
    queryFn: () => globalAPIHandlers.getAllProjectsMinimal("ExtraMinimal"),
    enabled: options?.enabled ?? true,
    ...(useHydrated()
      ? {}
      : { queryKey: [...queryKey, "hydrating"], enabled: false }),
    initialData: initialData ?? [],
  });
};
