import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import globalAPIHandlers from "@/utils/api/global";
import { useHydrated } from "@/hooks/General/useHydrated";

export const useGetAllProjectsMinimal = (
  queryKey: any,
  initialData?: any,
  options?: { enabled?: boolean; notifyOnChangeProps?: UseQueryOptions["notifyOnChangeProps"] },
) => {
  return useQuery({
    queryKey: queryKey,
    queryFn: () => globalAPIHandlers.getAllProjectsMinimal("ExtraMinimal"),
    enabled: options?.enabled ?? true,
    ...(options?.notifyOnChangeProps === undefined
      ? {}
      : { notifyOnChangeProps: options.notifyOnChangeProps }),
    ...(useHydrated()
      ? {}
      : { queryKey: [...queryKey, "hydrating"], enabled: false }),
    initialData: initialData ?? [],
  });
};
