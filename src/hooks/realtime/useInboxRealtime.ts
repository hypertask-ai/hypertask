import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  connectRealtimeClient,
  releaseRealtimeClientIfIdle,
} from "@/lib/realtime/client";
import { INBOX_EVENT, userChannel } from "@/lib/realtime/shared";
import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";
import { getInboxDocument } from "@/lib/firstScreen/inboxDocument";
import { runRealtimeReconciliation } from "@/lib/realtime/latencyCanary";

export const createInboxRealtimeEventHandler = (
  refetch: (trigger: "event") => void,
) => {
  return () => refetch("event");
};

export function useInboxRealtime(userId: number | null | undefined): void {
  const queryClient = useQueryClient();
  const seeded = Boolean(getInboxDocument(useFirstScreenSurface(userId), userId ?? 0));
  const wasConnected = useRef(false);

  useEffect(() => {
    if (userId == null) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let caughtUp = false;
    const catchUp = () => {
      if (!seeded || cancelled || caughtUp) return;
      caughtUp = true;
      void queryClient.refetchQueries({ queryKey: ["inbox", "data", userId], exact: true });
    };
    const catchUpTimer = seeded ? setTimeout(catchUp, 1500) : undefined;

    const refetch = (trigger: "event" | "reconnect" = "event") => {
      void runRealtimeReconciliation({
        accountId: userId,
        surface: "inbox",
        trigger,
        reconcile: () =>
          Promise.all([
            queryClient.refetchQueries({ queryKey: ["inbox"] }),
            queryClient.refetchQueries({
              queryKey: ["agent-inbox"],
              type: "active",
            }),
          ]).then(() => undefined),
        networkUrlPatterns: ["/api/notifications/getAll", "/api/agents/"],
      });
    };

    void (async () => {
      const client = await connectRealtimeClient();
      if (!client) return;
      if (cancelled) {
        releaseRealtimeClientIfIdle(client);
        return;
      }

      const channelName = userChannel(userId);
      const channel = client.subscribe(channelName);
      const onInboxEvent = createInboxRealtimeEventHandler(refetch);
      channel.bind(INBOX_EVENT, onInboxEvent);
      channel.bind("pusher:subscription_succeeded", catchUp);
      if (channel.subscribed) catchUp();
      if (client.connection.state === "connected") wasConnected.current = true;
      const onConnected = () => {
        if (wasConnected.current) refetch("reconnect");
        wasConnected.current = true;
      };
      client.connection.bind("connected", onConnected);

      unsubscribe = () => {
        channel.unbind(INBOX_EVENT, onInboxEvent);
        channel.unbind("pusher:subscription_succeeded", catchUp);
        client.connection.unbind("connected", onConnected);
        client.unsubscribe(channelName);
        releaseRealtimeClientIfIdle(client);
      };
    })();

    return () => {
      cancelled = true;
      clearTimeout(catchUpTimer);
      unsubscribe?.();
    };
  }, [userId, queryClient, seeded]);
}
