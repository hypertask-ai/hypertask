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

// Subscribes to this user's private channel and refetches the inbox query
// on any INBOX_EVENT. Mounted once in GlobalProvider so the blue dot /
// unread count updates live without a page refresh.
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
    // Realtime can be unavailable. Still reconcile through the normal fenced
    // query, never write the unfenced document to the durable snapshot.
    const catchUpTimer = seeded ? setTimeout(catchUp, 1500) : undefined;

    const refetch = (trigger: "event" | "reconnect" = "event") => {
      void runRealtimeReconciliation({
        accountId: userId,
        surface: "inbox",
        trigger,
        reconcile: () =>
          Promise.all([
            queryClient.refetchQueries({ queryKey: ["inbox"] }),
            // ["inbox"] does not prefix-match ["agent-inbox", agentId], so the agent inbox
            // never refreshed on a realtime event (HTPR-4090). Active-only: there is one
            // cache key per agent and they live for gcTime, so refetching all of them would
            // hit every agent visited this session, including revoked ones.
            queryClient.refetchQueries({
              queryKey: ["agent-inbox"],
              type: "active",
            }),
          ]).then(() => undefined),
        // HTPR-6166: the endpoints this reconcile actually calls.
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
