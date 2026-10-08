import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/General/useAuth";
import { useFlag, useFlagReady } from "@/hooks/useFlag";
import { HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG } from "@/lib/flags/keys";
import { fetchTaskDetailMeta, shouldRefetchDetailOnMount } from "@/lib/taskDetailReads";
import type { TaskDetailMeta } from "@/utils/api/global/apiHelpers/getTaskDetailMeta";

export function useTaskDetailMetaField(field: keyof TaskDetailMeta, queryKey: any, taskId: number | null, queryFn: () => Promise<any>, initialData?: any) {
  const queryClient = useQueryClient();
  const { authenticatedUserId } = useAuth();
  const flagReady = useFlagReady(HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG);
  const dedupe = useFlag(HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG) && !!authenticatedUserId;
  return useQuery({
    queryKey,
    queryFn: dedupe ? async () => {
      const refresh = (queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0) > 0;
      const meta = await fetchTaskDetailMeta(queryClient, taskId!, refresh);
      return meta[field];
    } : queryFn,
    initialData: dedupe ? (field === "priority" || field === "estimate" ? initialData : undefined) : initialData ?? (field === "priority" ? null : []),
    ...(flagReady && !dedupe ? {} : { enabled: flagReady && !!taskId }),
    ...(dedupe ? { placeholderData: field === "labels" || field === "followers" ? [] : undefined, refetchOnMount: shouldRefetchDetailOnMount } : {}),
  });
}
