import { logger as htLogger } from "#logger";
import { useEffect, useRef } from "react";
import {
  connectRealtimeClient,
  releaseRealtimeClientIfIdle,
} from "@/lib/realtime/client";
import { BOARD_EVENT, boardChannel } from "@/lib/realtime/shared";

export const MY_TASKS_RECONCILE_INTERVAL_MS = 10_000;

export const createMyTasksRealtimeEventHandler = (
  refresh: (trigger: "event") => void,
) => {
  return () => refresh("event");
};

/** Board channels → reconcile. Refresh only after channels are live (HTPR-6458). */
export function useMyTasksRealtime(
  accountId: number,
  projectIds: number[],
  enabled: boolean,
  onReconcile: (
    trigger: "realtime" | "initial",
  ) => void | boolean | Promise<void | boolean>,
): void {
  const wasConnected = useRef(false);
  const reconcileRef = useRef(onReconcile);

  useEffect(() => {
    reconcileRef.current = onReconcile;
  }, [onReconcile]);

  useEffect(() => {
    if (!enabled || projectIds.length === 0 || !accountId) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;

    const refresh = (trigger: "event" | "reconnect" | "initial" = "event") => {
      if (cancelled) return;
      void reconcileRef.current(
        trigger === "initial" ? "initial" : "realtime",
      );
    };
    const canReconcile = () =>
      document.visibilityState === "visible" && navigator.onLine !== false;
    const runFallback = () => {
      if (fallbackTimer !== null && canReconcile()) refresh();
    };
    const stopFallback = () => {
      if (fallbackTimer !== null) clearInterval(fallbackTimer);
      fallbackTimer = null;
    };
    const startFallback = (reconcileNow = true) => {
      if (cancelled) return;
      if (fallbackTimer === null) {
        fallbackTimer = setInterval(
          runFallback,
          MY_TASKS_RECONCILE_INTERVAL_MS,
        );
      }
      if (reconcileNow) runFallback();
    };
    const onVisibilityChange = () => runFallback();
    const onOnline = () => runFallback();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    startFallback(false);

    void (async () => {
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

        const subscribedChannels = new Set<string>();
        const channels = projectIds.map((id) => {
          const channelName = boardChannel(id);
          const channel = client.subscribe(channelName);
          const onBoardEvent = createMyTasksRealtimeEventHandler(() =>
            refresh("event"),
          );
          const onSubscriptionSucceeded = () => {
            subscribedChannels.add(channelName);
            if (subscribedChannels.size === projectIds.length) stopFallback();
          };
          const onSubscriptionError = () => startFallback();
          channel.bind(BOARD_EVENT, onBoardEvent);
          channel.bind("pusher:subscription_succeeded", onSubscriptionSucceeded);
          channel.bind("pusher:subscription_error", onSubscriptionError);
          if (channel.subscribed) onSubscriptionSucceeded();
          return {
            channelName,
            channel,
            onBoardEvent,
            onSubscriptionError,
            onSubscriptionSucceeded,
          };
        });

        const onConnected = () => {
          if (wasConnected.current) refresh("reconnect");
          else refresh("initial");
          wasConnected.current = true;
        };
        const onConnectionStateChange = ({ current }: { current?: string }) => {
          if (
            current === "unavailable" ||
            current === "failed" ||
            current === "disconnected"
          ) {
            subscribedChannels.clear();
            startFallback();
          }
        };
        client.connection.bind("connected", onConnected);
        client.connection.bind("state_change", onConnectionStateChange);
        if (client.connection.state === "connected") onConnected();
        onConnectionStateChange({ current: client.connection.state });

        unsubscribe = () => {
          client.connection.unbind("connected", onConnected);
          client.connection.unbind("state_change", onConnectionStateChange);
          for (const {
            channelName,
            channel,
            onBoardEvent,
            onSubscriptionError,
            onSubscriptionSucceeded,
          } of channels) {
            channel.unbind(BOARD_EVENT, onBoardEvent);
            channel.unbind(
              "pusher:subscription_succeeded",
              onSubscriptionSucceeded,
            );
            channel.unbind("pusher:subscription_error", onSubscriptionError);
            client.unsubscribe(channelName);
          }
          releaseRealtimeClientIfIdle(client);
        };
      } catch (error) {
        htLogger.error("[my-tasks] realtime subscribe failed", error);
        startFallback();
      }
    })();

    return () => {
      cancelled = true;
      stopFallback();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, enabled, projectIds.map((id) => id).join(",")]);
}
