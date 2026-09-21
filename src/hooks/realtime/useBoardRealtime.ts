import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  connectRealtimeClient,
  releaseRealtimeClientIfIdle,
} from "@/lib/realtime/client";
import { projectPlanningQueryKey } from "@/lib/projectPlanning";
import { BOARD_EVENT, boardChannel } from "@/lib/realtime/shared";
import {
  reconcileActiveBoardQuery,
  reconcileActiveBoardTasks,
} from "@/lib/boardSync/reconcileActiveBoardQuery";
import { runRealtimeReconciliation } from "@/lib/realtime/latencyCanary";
import { useFlag } from "@/hooks/useFlag";
import { SCOPED_BOARD_REFETCH_FLAG } from "@/lib/flags/keys";
import { createBoardRealtimeEventHandler } from "@/lib/realtime/boardRealtimeEventHandler";

export { createBoardRealtimeEventHandler } from "@/lib/realtime/boardRealtimeEventHandler";

// Subscribes the open board to its realtime channel. On any change event
// (from another user, another tab, or the CLI/MCP acting as you) it immediately
// reconciles the ["projectsAll"] cache that the whole board renders from: for a
// change event, only the changed board's tasks are fetched and patched into the
// list; a reconnect still refetches the whole list, because that is also when
// account-wide access is re-proved. See HTPR-6166.
// No echo suppression on purpose: the CLI acts as the same user, so your own
// CLI edits must still refresh your own open board.
export function useBoardRealtime(
  projectId: number | null | undefined,
  options?: { accountId?: number },
): void {
  const queryClient = useQueryClient();
  const scopedRefetch = useFlag(SCOPED_BOARD_REFETCH_FLAG);
  const pickEventReconcile = () => {
    if (scopedRefetch) return reconcileActiveBoardTasks;
    return reconcileActiveBoardQuery;
  };
  const eventReconcile = pickEventReconcile();
  const wasConnected = useRef(false);

  useEffect(() => {
    if (projectId == null) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let scopedDirty = false;
    let scopedDrain: Promise<void> | null = null;

    const runScopedReconcile = async (userId: number): Promise<void> => {
      scopedDirty = true;
      if (scopedDrain) {
        await scopedDrain;
        if (scopedDirty) await runScopedReconcile(userId);
        return;
      }
      scopedDrain = (async () => {
        try {
          do {
            scopedDirty = false;
            await reconcileActiveBoardTasks(queryClient, projectId, userId);
          } while (scopedDirty);
        } finally {
          scopedDrain = null;
        }
      })();
      await scopedDrain;
      if (scopedDirty) await runScopedReconcile(userId);
    };

    const refetch = (trigger: "event" | "reconnect" = "event") => {
      const userId = options?.accountId;
      const reconcile = () =>
        Promise.all([
          eventReconcile === reconcileActiveBoardTasks &&
          trigger === "event" &&
          userId !== undefined
            ? runScopedReconcile(userId)
            : reconcileActiveBoardQuery(queryClient, projectId),
          queryClient.refetchQueries({
            exact: true,
            queryKey: projectPlanningQueryKey(projectId),
          }),
        ]).then(() => undefined);
      if (userId === undefined) {
        void reconcile().catch(() => undefined);
      } else {
        void runRealtimeReconciliation({
          accountId: userId,
          surface: "board",
          trigger,
          reconcile,
          // HTPR-6166: the endpoints this reconcile actually calls, so
          // network_ms only counts this reconciliation's own fetches.
          networkUrlPatterns: [
            "/api/projects/boardTasks",
            "/api/projects/getAll",
            "/api/projects/planning",
          ],
          projectId,
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
      let initialCatchUpComplete = false;
      // The initial board query can settle before Pusher finishes subscribing.
      // Pull once after server confirmation to recover events from that gap.
      const onSubscriptionSucceeded = () => {
        if (initialCatchUpComplete) return;
        initialCatchUpComplete = true;
        void reconcileActiveBoardQuery(queryClient, projectId).catch(
          () => undefined,
        );
        void queryClient
          .refetchQueries({
            exact: true,
            queryKey: projectPlanningQueryKey(projectId),
          })
          .catch(() => undefined);
      };
      channel.bind(BOARD_EVENT, onBoardEvent);
      channel.bind("pusher:subscription_succeeded", onSubscriptionSucceeded);
      if (channel.subscribed) onSubscriptionSucceeded();
      // Reconnect safety-net: pull once after a dropped connection recovers.
      // The initial connection is covered by the subscription catch-up above.
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
        channel.unbind(
          "pusher:subscription_succeeded",
          onSubscriptionSucceeded,
        );
        client.connection.unbind("connected", onConnected);
        client.unsubscribe(channelName);
        releaseRealtimeClientIfIdle(client);
      };
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [
    options?.accountId,
    projectId,
    queryClient,
    scopedRefetch,
    eventReconcile,
  ]);
}
