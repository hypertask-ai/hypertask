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
import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";
import { getBoardDocument } from "@/lib/firstScreen/boardDocument";
import { createBoardRealtimeEventHandler } from "@/lib/realtime/boardRealtimeEventHandler";

export { createBoardRealtimeEventHandler } from "@/lib/realtime/boardRealtimeEventHandler";

export const BOARD_RECONCILE_INTERVAL_MS = 10_000;

export function useBoardRealtime(
  projectId: number | null | undefined,
  options?: { accountId?: number },
): void {
  const queryClient = useQueryClient();
  const seeded = Boolean(getBoardDocument(useFirstScreenSurface(options?.accountId), options?.accountId ?? 0, projectId));
  const wasConnected = useRef(false);

  useEffect(() => {
    if (projectId == null) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let scopedDirty = false;
    let scopedDrain: Promise<void> | null = null;
    let fallbackActive = false;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let fallbackInFlight = false;
    let connectionAttemptInFlight = false;

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
          networkUrlPatterns: [
            "/api/projects/boardTasks",
            "/api/projects/getAll",
            "/api/projects/planning",
          ],
          projectId,
        });
      }
    };

    const canReconcile = () =>
      !cancelled &&
      (typeof document === "undefined" ||
        document.visibilityState === "visible") &&
      (typeof navigator === "undefined" || navigator.onLine !== false);
    const runFallbackCycle = () => {
      if (!fallbackActive || !canReconcile()) return;
      const userId = options?.accountId;
      if (userId !== undefined && !fallbackInFlight) {
        fallbackInFlight = true;
        void Promise.allSettled([
          reconcileActiveBoardTasks(queryClient, projectId, userId, {
            background: true,
          }),
          queryClient.refetchQueries({
            exact: true,
            queryKey: projectPlanningQueryKey(projectId),
          }),
        ]).finally(() => {
            fallbackInFlight = false;
          });
      }
      void connectAndSubscribe();
    };
    const stopFallback = () => {
      fallbackActive = false;
      if (fallbackTimer !== null) clearInterval(fallbackTimer);
      fallbackTimer = null;
    };
    const startFallback = () => {
      if (cancelled || fallbackActive) return;
      fallbackActive = true;
      void connectAndSubscribe();
      fallbackTimer = setInterval(runFallbackCycle, BOARD_RECONCILE_INTERVAL_MS);
    };
    const onVisibilityChange = () => runFallbackCycle();
    const onOnline = () => runFallbackCycle();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
    }

    const connectAndSubscribe = async () => {
      if (cancelled || connectionAttemptInFlight || unsubscribe) return;
      connectionAttemptInFlight = true;
      try {
      const client = await connectRealtimeClient();
      if (!client) {
        startFallback();
        return;
      }
      if (cancelled) {
        releaseRealtimeClientIfIdle(client);
        return;
      }

      const channelName = boardChannel(projectId);
      const channel = client.subscribe(channelName);
      const onBoardEvent = createBoardRealtimeEventHandler(refetch);
      let initialCatchUpComplete = false;
      const onSubscriptionSucceeded = () => {
        if (cancelled) return;
        stopFallback();
        if (initialCatchUpComplete) return;
        initialCatchUpComplete = true;
        void (seeded && options?.accountId !== undefined
          ? reconcileActiveBoardTasks(queryClient, projectId, options.accountId, { background: true })
          : reconcileActiveBoardQuery(queryClient, projectId)).catch(() => undefined);
        void queryClient
          .refetchQueries({
            exact: true,
            queryKey: projectPlanningQueryKey(projectId),
          })
          .catch(() => undefined);
      };
      const onSubscriptionError = () => {
        if (cancelled) return;
        const teardown = unsubscribe;
        unsubscribe = undefined;
        teardown?.();
        startFallback();
      };
      const onConnectionStateChange = ({ current }: { current?: string }) => {
        if (cancelled) return;
        if (
          current !== "unavailable" &&
          current !== "failed" &&
          current !== "disconnected"
        ) {
          return;
        }
        const teardown = unsubscribe;
        unsubscribe = undefined;
        teardown?.();
        startFallback();
      };
      channel.bind(BOARD_EVENT, onBoardEvent);
      channel.bind("pusher:subscription_succeeded", onSubscriptionSucceeded);
      channel.bind("pusher:subscription_error", onSubscriptionError);
      client.connection.bind("state_change", onConnectionStateChange);
      if (client.connection.state === "connected") wasConnected.current = true;
      const onConnected = () => {
        if (wasConnected.current && !fallbackActive) refetch("reconnect");
        wasConnected.current = true;
      };
      client.connection.bind("connected", onConnected);

      unsubscribe = () => {
        channel.unbind(BOARD_EVENT, onBoardEvent);
        channel.unbind(
          "pusher:subscription_succeeded",
          onSubscriptionSucceeded,
        );
        channel.unbind("pusher:subscription_error", onSubscriptionError);
        client.connection.unbind("state_change", onConnectionStateChange);
        client.connection.unbind("connected", onConnected);
        client.unsubscribe(channelName);
        releaseRealtimeClientIfIdle(client);
      };
      if (channel.subscribed) onSubscriptionSucceeded();
      onConnectionStateChange({ current: client.connection.state });
      } catch {
        startFallback();
      } finally {
        connectionAttemptInFlight = false;
      }
    };
    void connectAndSubscribe();

    return () => {
      cancelled = true;
      fallbackActive = false;
      if (fallbackTimer !== null) clearInterval(fallbackTimer);
      fallbackTimer = null;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
      }
      unsubscribe?.();
    };
  }, [
    options?.accountId,
    projectId,
    queryClient,
    seeded,
  ]);
}
