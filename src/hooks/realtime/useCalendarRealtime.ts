import { useEffect, useRef } from "react";
import {
  connectRealtimeClient,
  releaseRealtimeClientIfIdle,
} from "@/lib/realtime/client";
import { BOARD_EVENT, boardChannel } from "@/lib/realtime/shared";
import {
  markRealtimeRequestStarted,
  runRealtimeReconciliation,
} from "@/lib/realtime/latencyCanary";

export const createCalendarRealtimeEventHandler = (
  refresh: (trigger: "event") => void,
) => {
  return () => refresh("event");
};

// Subscribes to every project channel the calendar currently displays.
// On any BOARD_EVENT (task created/updated/moved/deleted on any of those boards)
// it reconciles the active range through the authoritative Calendar endpoint.
export function useCalendarRealtime(
  accountId: number,
  projectIds: number[],
  onReconcile: (trigger: "realtime") => void | boolean | Promise<void | boolean>,
): void {
  const wasConnected = useRef(false);
  const reconcileRef = useRef(onReconcile);

  useEffect(() => {
    reconcileRef.current = onReconcile;
  }, [onReconcile]);

  useEffect(() => {
    if (projectIds.length === 0) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const refresh = (trigger: "event" | "reconnect" = "event") => {
      void runRealtimeReconciliation({
        accountId,
        surface: "calendar",
        trigger,
        reconcile: () => {
          const reconciliation = reconcileRef.current("realtime");
          return reconciliation instanceof Promise
            ? markRealtimeRequestStarted(reconciliation)
            : reconciliation;
        },
      });
    };

    void (async () => {
      const client = await connectRealtimeClient();
      if (!client) return;
      if (cancelled) {
        releaseRealtimeClientIfIdle(client);
        return;
      }

      const channels = projectIds.map((id) => {
        const channelName = boardChannel(id);
        const channel = client.subscribe(channelName);
        const onBoardEvent = createCalendarRealtimeEventHandler(refresh);
        channel.bind(BOARD_EVENT, onBoardEvent);
        return { channelName, channel, onBoardEvent };
      });

      // Reconnect safety-net: re-fetch once after a dropped connection recovers.
      // Skipped on the INITIAL connection (HTPR-3998) — the page just rendered,
      // so refreshing there just doubled every page load.
      // Mounted while already connected (e.g. view opened later in the session):
      // count that as connected so a real drop+recover still refetches.
      if (client.connection.state === "connected") wasConnected.current = true;
      const onConnected = () => {
        if (wasConnected.current) refresh("reconnect");
        wasConnected.current = true;
      };
      client.connection.bind("connected", onConnected);

      unsubscribe = () => {
        client.connection.unbind("connected", onConnected);
        for (const { channelName, channel, onBoardEvent } of channels) {
          channel.unbind(BOARD_EVENT, onBoardEvent);
          client.unsubscribe(channelName);
        }
        releaseRealtimeClientIfIdle(client);
      };
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, projectIds.map((id) => id).join(",")]);
}
