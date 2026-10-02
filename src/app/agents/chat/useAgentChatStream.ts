"use client";

import { connectRealtimeClient, releaseRealtimeClientIfIdle, } from "@/lib/realtime/client";
import { AGENT_CHAT_EVENT, userChannel } from "@/lib/realtime/shared";
import { useEffect } from "react";
import { ACTIVITY_POLL_MS, AWAITING_POLL_MAX_MS, AWAITING_POLL_MS, CHAT_AVAILABILITY_POLL_MS, LEGACY_AWAITING_POLL_MAX_MS } from "./agentChatTypes";
import { bumpRosterChatRecency } from "./rosterSort";
import type { useAgentChatRoster } from "./useAgentChatRoster";
import type { useAgentChatSession } from "./useAgentChatSession";
import type { useAgentChatState } from "./useAgentChatState";

type Props = Pick<
  ReturnType<typeof useAgentChatState>,
  | "awaiting"
  | "session"
  | "setAwaitingSince"
  | "setReplyTimedOut"
  | "messages"
  | "deliveryNotice"
  | "awaitingSince"
  | "pollingChatEnabled"
  | "activityRowsEnabled"
  | "currentUser"
  | "sessionIdRef"
  | "selectedIdRef"
  | "setAgents"
  | "rosterGenRef"
  | "liveSortEnabled"
> &
  Pick<
  ReturnType<typeof useAgentChatSession>,
  | "loadMessages"
> &
  Pick<
  ReturnType<typeof useAgentChatRoster>,
  | "loadAgents"
>;

export function useAgentChatStream({
  awaiting, session, setAwaitingSince, setReplyTimedOut, messages, deliveryNotice, awaitingSince,
  pollingChatEnabled, loadMessages, activityRowsEnabled, currentUser, sessionIdRef, selectedIdRef,
  setAgents, rosterGenRef, loadAgents, liveSortEnabled,
}: Props) {
  // Record when the current wait began so the poll below can time out; a new
  // wait for the same session (a fresh send) restarts the clock. On reload the
  // stored message time prevents an old unanswered turn looking fresh again.
  useEffect(() => {
    if (!awaiting || !session) {
      setAwaitingSince(null);
      setReplyTimedOut(false);
      return;
    }
    const latestMessageAt = Date.parse(messages?.at(-1)?.createdAt ?? "");
    setAwaitingSince((prev) =>
      prev?.sessionId === session.id
        ? prev
        : {
            sessionId: session.id,
            at: Number.isNaN(latestMessageAt) ? Date.now() : latestMessageAt,
          },
    );
  }, [awaiting, messages, session]);

  useEffect(() => {
    if (!awaiting || !session) return;
    // The runtime has not enabled chat, so the message will never be
    // delivered and polling cannot help.
    if (deliveryNotice) return;
    const sinceAt =
      awaitingSince?.sessionId === session.id ? awaitingSince.at : Date.now();
    const maxWait = pollingChatEnabled
      ? AWAITING_POLL_MAX_MS
      : LEGACY_AWAITING_POLL_MAX_MS;
    const remaining = sinceAt + maxWait - Date.now();
    const markTimedOut = () => {
      if (!pollingChatEnabled) return;
      console.error("[agent-chat] no reply after three minutes");
      setReplyTimedOut(true);
    };
    if (remaining <= 0) {
      markTimedOut();
      return;
    }
    const id = setInterval(
      () => void loadMessages(session.id),
      AWAITING_POLL_MS,
    );
    const stop = setTimeout(() => {
      clearInterval(id);
      markTimedOut();
    }, remaining);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [
    awaiting,
    session,
    deliveryNotice,
    awaitingSince,
    loadMessages,
    pollingChatEnabled,
  ]);

  // Activity rows arrive without a chat reply, so they are not covered by the
  // reply poll above. loadMessages drops stale responses by generation, so an
  // overlap with that poll is harmless. Nobody is reading a hidden tab, and the
  // query behind each tick is not cheap, so pause while the tab is hidden and
  // refetch once on the way back.
  useEffect(() => {
    if (!session || !activityRowsEnabled) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (id === undefined) {
        id = setInterval(() => void loadMessages(session.id), ACTIVITY_POLL_MS);
      }
    };
    const stop = () => {
      if (id !== undefined) clearInterval(id);
      id = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return stop();
      // Catch up on whatever happened while hidden instead of waiting 5s.
      void loadMessages(session.id);
      start();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [session, activityRowsEnabled, loadMessages]);

  // Poll delivery availability while an idle chat has no faster reply or
  // activity poll, including a catch-up as soon as a hidden tab returns.
  useEffect(() => {
    if (!session || !pollingChatEnabled || awaiting || activityRowsEnabled) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (id === undefined) {
        id = setInterval(
          () => void loadMessages(session.id),
          CHAT_AVAILABILITY_POLL_MS,
        );
      }
    };
    const stop = () => {
      if (id !== undefined) clearInterval(id);
      id = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return stop();
      void loadMessages(session.id);
      start();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [
    activityRowsEnabled,
    awaiting,
    loadMessages,
    pollingChatEnabled,
    session,
  ]);

  // Realtime nudge: the send route broadcasts agent-chat:changed on this
  // user's private channel; refetch instead of waiting for the next poll.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      const client = await connectRealtimeClient();
      if (!client) return;
      if (cancelled) {
        releaseRealtimeClientIfIdle(client);
        return;
      }

      const channelName = userChannel(currentUser.id);
      const channel = client.subscribe(channelName);
      const onChatEvent = (
        payload: { sessionId?: string; agentId?: string } | undefined,
      ) => {
        const currentSessionId = sessionIdRef.current;
        const isOpenSessionEvent =
          currentSessionId !== null &&
          (payload?.sessionId === currentSessionId ||
            (activityRowsEnabled &&
              payload?.agentId &&
              payload.agentId === selectedIdRef.current));
        if (isOpenSessionEvent) {
          void loadMessages(currentSessionId);
          // Open-chat recency: always bump locally; the flag only controls
          // sort display. Avoids a second /api/agents/owned fetch per message.
          const agentId = selectedIdRef.current;
          if (agentId) {
            const now = new Date().toISOString();
            setAgents((prev) => bumpRosterChatRecency(prev, agentId, now));
          }
          return;
        }
        // A message in a thread this person is not looking at: the roster
        // carries the unread count, so it is the roster that has to refresh.
        const myGen = ++rosterGenRef.current;
        void loadAgents()
          .then((loaded) => {
            if (myGen === rosterGenRef.current) setAgents(loaded);
          })
          .catch(() => {
            // A missed refresh only delays the badge to the next visit.
          });
      };
      channel.bind(AGENT_CHAT_EVENT, onChatEvent);

      unsubscribe = () => {
        channel.unbind(AGENT_CHAT_EVENT, onChatEvent);
        client.unsubscribe(channelName);
        releaseRealtimeClientIfIdle(client);
      };
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [currentUser.id, loadMessages, loadAgents, activityRowsEnabled, liveSortEnabled]);

}
