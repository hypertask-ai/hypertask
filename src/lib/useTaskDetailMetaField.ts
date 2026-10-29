import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/General/useAuth";
import { useHydrated } from "@/hooks/General/useHydrated";
import { fetchTaskDetailMeta, shouldRefetchDetailOnMount } from "@/lib/taskDetailReads";
import type { TaskDetailMeta } from "@/utils/api/global/apiHelpers/getTaskDetailMeta";

export function useTaskDetailMetaField(field: keyof TaskDetailMeta, queryKey: any, taskId: number | null, queryFn: () => Promise<any>, initialData?: any) {
  const queryClient = useQueryClient();
  const { authenticatedUserId } = useAuth();
  const dedupe = !!authenticatedUserId;
  const hydrated = useHydrated();
  return useQuery({
    queryKey,
    queryFn: dedupe ? async () => {
      const refresh = (queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0) > 0;
      const meta = await fetchTaskDetailMeta(queryClient, taskId!, refresh);
      return meta[field];
    } : queryFn,
    initialData: dedupe ? (field === "priority" || field === "estimate" ? initialData : undefined) : initialData ?? (field === "priority" ? null : []),
    ...(dedupe ? { enabled: !!taskId } : {}),
    ...(dedupe ? { placeholderData: field === "labels" || field === "followers" ? [] : undefined, refetchOnMount: shouldRefetchDetailOnMount } : {}),
    ...(hydrated ? {} : { queryKey: [...queryKey, "hydrating"], enabled: false }),
  });
}
