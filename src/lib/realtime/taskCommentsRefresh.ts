import type { QueryClient } from "@tanstack/react-query";
import globalConstants from "@/lib/constants";

export function refreshTaskComments(
  queryClient: QueryClient,
  taskId: number
): Promise<void> {
  return queryClient.refetchQueries({
    queryKey: [globalConstants.CommentsTQPrefixKey, taskId],
  });
}
