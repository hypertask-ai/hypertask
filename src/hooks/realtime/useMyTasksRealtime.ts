import { useEffect, useRef } from "react";
import {
  connectRealtimeClient,
  releaseRealtimeClientIfIdle,
} from "@/lib/realtime/client";
import { BOARD_EVENT, boardChannel } from "@/lib/realtime/shared";

export const createMyTasksRealtimeEventHandler = (
  refresh: (trigger: "event") => void,
) => {
  return () => refresh("event");
};

/**
 * Subscribes to every accessible board channel. On board:changed (or reconnect),
 * calls onReconcile so My Tasks can refetch /api/my-tasks.
 *
 * Unlike calendar, runs one reconcile right after subscribe so events that
 * landed between SSR and the subscription are not missed (HTPR-6458 grill).
 */
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

    const refresh = (trigger: "event" | "reconnect" | "initial" = "event") => {
      void reconcileRef.current(
        trigger === "initial" ? "initial" : "realtime",
      );
    };

    void (async () => {
      try {
        const client = await connectRealtimeClient();
        if (!client) return;
        if (cancelled) {
          releaseRealtimeClientIfIdle(client);
          return;
        }

        const channels = projectIds.map((id) => {
          const channelName = boardChannel(id);
          const channel = client.subscribe(channelName);
          const onBoardEvent = createMyTasksRealtimeEventHandler(() =>
            refresh("event"),
          );
          channel.bind(BOARD_EVENT, onBoardEvent);
          return { channelName, channel, onBoardEvent };
        });

        if (client.connection.state === "connected") wasConnected.current = true;
        const onConnected = () => {
          if (wasConnected.current) refresh("reconnect");
          wasConnected.current = true;
        };
        client.connection.bind("connected", onConnected);

        // Close the SSR-to-subscribe gap: one fetch after channels are live.
        refresh("initial");

        unsubscribe = () => {
          client.connection.unbind("connected", onConnected);
          for (const { channelName, channel, onBoardEvent } of channels) {
            channel.unbind(BOARD_EVENT, onBoardEvent);
            client.unsubscribe(channelName);
          }
          releaseRealtimeClientIfIdle(client);
        };
      } catch (error) {
        console.error("[my-tasks] realtime subscribe failed", error);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, enabled, projectIds.map((id) => id).join(",")]);
}
