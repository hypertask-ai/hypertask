"use client";

import { connectRealtimeClient, releaseRealtimeClientIfIdle, } from "@/lib/realtime/client";
import { AGENT_CHAT_EVENT, userChannel } from "@/lib/realtime/shared";
import { useEffect } from "react";
import { ACTIVITY_POLL_MS, AWAITING_POLL_MAX_MS, AWAITING_POLL_MS, CHAT_AVAILABILITY_POLL_MS } from "./agentChatTypes";
import { bumpRosterChatRecency } from "./rosterSort";
import type { useAgentChatRoster } from "./useAgentChatRoster";
import type { useAgentChatSession } from "./useAgentChatSession";
import type { useAgentChatState } from "./useAgentChatState";

type Props = Pick<
  ReturnType<typeof useAgentChatState>,
  | "embedded"
  | "awaiting"
  | "session"
  | "setAwaitingSince"
  | "setReplyTimedOut"
  | "messages"
  | "deliveryNotice"
  | "awaitingSince"
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
  embedded, awaiting, session, setAwaitingSince, setReplyTimedOut, messages, deliveryNotice, awaitingSince,
  loadMessages, activityRowsEnabled, currentUser, sessionIdRef, selectedIdRef,
  setAgents, rosterGenRef, loadAgents, liveSortEnabled,
}: Props) {
  useEffect(() => {
    if (embedded && !embedded.active) return;
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
  }, [awaiting, messages, session, embedded?.active]);

  useEffect(() => {
    if (embedded && !embedded.active) return;
    if (!awaiting || !session) return;
    if (deliveryNotice) return;
    const sinceAt =
      awaitingSince?.sessionId === session.id ? awaitingSince.at : Date.now();
    const remaining = sinceAt + AWAITING_POLL_MAX_MS - Date.now();
    const markTimedOut = () => {
      console.error("[agent-chat] no reply after three minutes");
      setReplyTimedOut(true);
    };
    if (remaining <= 0) {
      markTimedOut();
      return;
    }
    const id = setInterval(
      () => { if (!embedded || document.visibilityState === "visible") void loadMessages(session.id); },
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
    embedded?.active,
    awaiting,
    session,
    deliveryNotice,
    awaitingSince,
    loadMessages,
  ]);

  useEffect(() => {
    if (!embedded?.active || !awaiting || !session) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadMessages(session.id);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [embedded?.active, awaiting, session, loadMessages]);

  useEffect(() => {
    if (embedded && !embedded.active) return;
    if (!session || !activityRowsEnabled) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (id === undefined) {
        id = setInterval(() => { if (document.visibilityState === "visible") void loadMessages(session.id); }, ACTIVITY_POLL_MS);
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
  }, [session, activityRowsEnabled, loadMessages, embedded?.active]);

  useEffect(() => {
    if (embedded && !embedded.active) return;
    if (!session || awaiting || activityRowsEnabled) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (id === undefined) {
        id = setInterval(
          () => { if (document.visibilityState === "visible") void loadMessages(session.id); },
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
    embedded?.active,
    activityRowsEnabled,
    awaiting,
    loadMessages,
    session,
  ]);

  useEffect(() => {
    if (embedded && !embedded.active) return;
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
          const agentId = selectedIdRef.current;
          if (agentId) {
            const now = new Date().toISOString();
            setAgents((prev) => bumpRosterChatRecency(prev, agentId, now));
          }
          return;
        }
        const myGen = ++rosterGenRef.current;
        void loadAgents()
          .then((loaded) => {
            if (myGen === rosterGenRef.current) setAgents(loaded);
          })
          .catch(() => {
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
  }, [currentUser.id, loadMessages, loadAgents, activityRowsEnabled, liveSortEnabled, embedded?.active]);

}
