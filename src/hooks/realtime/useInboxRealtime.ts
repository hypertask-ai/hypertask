import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  connectRealtimeClient,
  releaseRealtimeClientIfIdle,
} from "@/lib/realtime/client";
import { INBOX_EVENT, userChannel } from "@/lib/realtime/shared";
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
  const wasConnected = useRef(false);

  useEffect(() => {
    if (userId == null) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

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
        client.connection.unbind("connected", onConnected);
        client.unsubscribe(channelName);
        releaseRealtimeClientIfIdle(client);
      };
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [userId, queryClient]);
}
