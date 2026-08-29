import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  connectRealtimeClient,
  releaseRealtimeClientIfIdle,
} from "@/lib/realtime/client";
import { projectPlanningQueryKey } from "@/lib/projectPlanning";
import { BOARD_EVENT, boardChannel } from "@/lib/realtime/shared";
import { reconcileActiveBoardQuery } from "@/lib/boardSync/reconcileActiveBoardQuery";
import { runRealtimeReconciliation } from "@/lib/realtime/latencyCanary";

export const createBoardRealtimeEventHandler = (
  refetch: (trigger: "event") => void,
) => {
  return () => refetch("event");
};

// Subscribes the open board to its realtime channel. On any change event
// (from another user, another tab, or the CLI/MCP acting as you) it immediately
// expires the active board snapshot and refetches the ["projectsAll"] cache
// that the whole board renders from.
// No echo suppression on purpose: the CLI acts as the same user, so your own
// CLI edits must still refresh your own open board.
export function useBoardRealtime(
  projectId: number | null | undefined,
  options?: { accountId?: number; enabled?: boolean },
): void {
  const queryClient = useQueryClient();
  const wasConnected = useRef(false);
  const needsCatchUp = useRef(options?.enabled === false);

  useEffect(() => {
    if (projectId == null || options?.enabled === false) {
      if (options?.enabled === false) needsCatchUp.current = true;
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const refetch = (trigger: "event" | "reconnect" = "event") => {
      const reconcile = () =>
        Promise.all([
          reconcileActiveBoardQuery(queryClient, projectId),
          queryClient.refetchQueries({
            exact: true,
            queryKey: projectPlanningQueryKey(projectId),
          }),
        ]).then(() => undefined);
      if (options?.accountId == null) {
        void reconcile().catch(() => undefined);
      } else {
        void runRealtimeReconciliation({
          accountId: options.accountId,
          surface: "board",
          trigger,
          reconcile,
        });
      }
    };

    void (async () => {
      const client = await connectRealtimeClient();
      if (!client) return;
      if (cancelled) {
        releaseRealtimeClientIfIdle(client);
        return;
      }

      const channelName = boardChannel(projectId);
      const channel = client.subscribe(channelName);
      const onBoardEvent = createBoardRealtimeEventHandler(refetch);
      channel.bind(BOARD_EVENT, onBoardEvent);
      // Mobile defers this connection until after usable paint. Reconcile once
      // on that false→true transition so an event that landed during the gap
      // cannot leave the freshly rendered Board stale.
      if (needsCatchUp.current) {
        needsCatchUp.current = false;
        void reconcileActiveBoardQuery(queryClient, projectId).catch(
          () => undefined,
        );
        void queryClient.refetchQueries({
          exact: true,
          queryKey: projectPlanningQueryKey(projectId),
        });
      }
      // Reconnect safety-net: pull once after a dropped connection recovers.
      // Skipped on the INITIAL connection (HTPR-3998) — the queries are already
      // fetching on mount, so refetching there just doubled every page load.
      // Mounted while already connected (e.g. view opened later in the session):
      // count that as connected so a real drop+recover still refetches.
      if (client.connection.state === "connected") wasConnected.current = true;
      const onConnected = () => {
        if (wasConnected.current) refetch("reconnect");
        wasConnected.current = true;
      };
      client.connection.bind("connected", onConnected);

      unsubscribe = () => {
        channel.unbind(BOARD_EVENT, onBoardEvent);
        client.connection.unbind("connected", onConnected);
        client.unsubscribe(channelName);
        releaseRealtimeClientIfIdle(client);
      };
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [options?.accountId, options?.enabled, projectId, queryClient]);
}
