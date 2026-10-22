"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFlag, useFlagReady } from "@/hooks/useFlag";
import { HTPR_7549_FIRST_TASK_POINTER_FLAG, HTPR_7550_CONNECT_OVERLAY_FLAG } from "@/lib/flags/keys";

type OverlayState = { eligible: boolean; sectionId?: number };

export function useConnectAgentOverlay(projectId: number, userId: number, active = true) {
  const pointerEnabled = useFlag(HTPR_7549_FIRST_TASK_POINTER_FLAG);
  const overlayEnabled = useFlag(HTPR_7550_CONNECT_OVERLAY_FLAG);
  const overlayReady = useFlagReady(HTPR_7550_CONNECT_OVERLAY_FLAG);
  const enabled = active && pointerEnabled && overlayEnabled;
  const queryClient = useQueryClient();
  const queryKey = ["connect-agent-overlay", userId, projectId];
  const { data, isPending, isError, isFetching } = useQuery<OverlayState>({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/projects/first-task-pointer?projectId=${projectId}&connectOverlay=1`, { cache: "no-store", signal });
      if (!response.ok) throw new Error("Connect overlay unavailable");
      return response.json();
    },
    enabled: enabled && projectId > 0 && userId > 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const close = async () => {
    await queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData<OverlayState>(queryKey, { eligible: false });
  };
  if (!overlayEnabled) return { enabled: false, blocked: false, open: false, sectionId: undefined, close };
  return {
    enabled,
    blocked: active && pointerEnabled && !isError && (!overlayReady || (enabled && (isPending || isFetching || data?.eligible === true))),
    open: enabled && !isPending && !isFetching && !isError && data?.eligible === true,
    sectionId: data?.sectionId,
    close,
  };
}
