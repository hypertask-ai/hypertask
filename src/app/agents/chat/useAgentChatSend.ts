"use client";

import { extractMessageLinks } from "@/lib/agents/messageLinks";
import { useCallback, useRef } from "react";
import toast from "react-hot-toast";
import { MAX_MESSAGE_LENGTH, TChatMessage } from "./agentChatTypes";
import { bumpRosterChatRecency } from "./rosterSort";
import type { useAgentChatFeed } from "./useAgentChatFeed";
import type { useAgentChatNavigation } from "./useAgentChatNavigation";
import type { useAgentChatRoster } from "./useAgentChatRoster";
import type { useAgentChatSession } from "./useAgentChatSession";
import type { useAgentChatState } from "./useAgentChatState";

type Props = Pick<
  ReturnType<typeof useAgentChatState>,
  | "sessionIdRef"
  | "selectedIdRef"
  | "setDeliveryNotice"
  | "setAwaiting"
  | "setReplyTimedOut"
  | "setAwaitingSince"
  | "setMessages"
  | "sendingRef"
  | "setSending"
  | "setAgents"
  | "blockedQueueIdRef"
  | "messageQueueRef"
  | "setQueuedMessages"
  | "setDraft"
  | "liveSortEnabled"
  | "awaitingRef"
  | "session"
  | "awaiting"
  | "stopping"
  | "setStopping"
  | "draft"
  | "dismissMention"
  | "composerEditorRef"
  | "composerRef"
  | "focusComposer"
  | "selectedId"
  | "messages"
> &
  Pick<
  ReturnType<typeof useAgentChatSession>,
  | "loadMessages"
  | "selectAgent"
> &
  Pick<
  ReturnType<typeof useAgentChatFeed>,
  | "composerLocked"
> &
  Pick<
  ReturnType<typeof useAgentChatNavigation>,
  | "roster"
> &
  Pick<
  ReturnType<typeof useAgentChatRoster>,
  | "projectIdForPrefix"
>;

export function useAgentChatSend({
  sessionIdRef, selectedIdRef, setDeliveryNotice, setAwaiting, setReplyTimedOut, setAwaitingSince,
  setMessages, sendingRef, setSending, setAgents, blockedQueueIdRef, messageQueueRef,
  setQueuedMessages, setDraft, liveSortEnabled, awaitingRef, session, awaiting, stopping,
  setStopping, loadMessages, draft, dismissMention, composerEditorRef, composerRef, focusComposer,
  composerLocked, roster, selectedId, selectAgent, messages, projectIdForPrefix,
}: Props) {
  // The actual POST, used by both a direct send and a drained queue item.
  // Reads the target session off sessionIdRef (not the `session` state
  // closure) so a queued send drained after the user switched agents can
  // still be safely dropped by the same staleness check a direct send uses.
  const sendMessageText = useCallback(async (text: string, queuedId?: string) => {
    const targetSessionId = sessionIdRef.current;
    const targetAgentId = selectedIdRef.current;
    if (!targetSessionId) return;
    const optimistic: TChatMessage = {
      // react-hooks/purity false-flags this pre-existing, unrelated line
      // purely from the shape of unrelated functions added elsewhere in this
      // component (confirmed by isolating each addition); sendMessageText
      // only ever runs from an event handler, never during render.
      // eslint-disable-next-line react-hooks/purity
      id: `optimistic-${Date.now()}`,
      role: "human",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setDeliveryNotice(false);
    setAwaiting(true);
    setReplyTimedOut(false);
    // A new message restarts the awaiting-poll bound.
    setAwaitingSince(null);
    setMessages((prev) => [...(prev ?? []), optimistic]);
    sendingRef.current = true;
    setSending(true);
    try {
      const res = await fetch(`/api/agent-chat/${targetSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        message?: TChatMessage;
        delivered?: boolean;
        error?: string;
      };
      if (!res.ok || !data.success || !data.message) {
        throw new Error(data.error ?? "Failed to send message");
      }
      const sentMessage = data.message;
      if (sessionIdRef.current !== targetSessionId) return;
      setMessages((prev) =>
        (prev ?? []).map((m) => (m.id === optimistic.id ? sentMessage : m)),
      );
      // Always record chat recency on send; liveSortEnabled only controls
      // whether the roster sorts by it. Use the agent captured at send start
      // so a chat switch mid-flight cannot bump the wrong row (HTPR-6283).
      if (targetAgentId) {
        setAgents((prev) =>
          bumpRosterChatRecency(
            prev,
            targetAgentId,
            sentMessage.createdAt ?? new Date().toISOString(),
          ),
        );
      }
      // The webhook outbox had no subscriber for chat.message: the agent will
      // never see this message unless its runtime is set up later.
      if (data.delivered === false) setDeliveryNotice(true);
    } catch (e) {
      if (sessionIdRef.current !== targetSessionId) return;
      // Roll the optimistic bubble back and reopen the composer.
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== optimistic.id));
      if (queuedId) {
        // A drained queue item failing must not free up the next item to
        // fire out of order: put it back at the front and block draining
        // until it's removed. The agent's earlier run is still live, which is
        // why this was queued, so `awaiting` has to stay true or the Stop
        // button and the poll both disappear until a reload.
        blockedQueueIdRef.current = queuedId;
        messageQueueRef.current = [{ id: queuedId, content: text }, ...messageQueueRef.current];
        setQueuedMessages(messageQueueRef.current);
      } else {
        setAwaiting(false);
        setDraft(text);
      }
      toast.error(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      sendingRef.current = false;
      setSending(false);
      // A queued follow-up drains via the `awaiting` effect above: success
      // leaves the ball with the agent (no-op here), and failure reverts the
      // optimistic message, which flips `awaiting` back to false and fires it.
    }
  }, [liveSortEnabled]);

  const removeQueuedMessage = useCallback((id: string) => {
    messageQueueRef.current = messageQueueRef.current.filter(
      (item) => item.id !== id,
    );
    setQueuedMessages(messageQueueRef.current);
    // Removing the item that blocked draining clears the block; anything
    // still behind it in the queue is free to send again.
    if (blockedQueueIdRef.current === id) blockedQueueIdRef.current = null;
  }, []);

  const drainQueuedMessage = useCallback(() => {
    if (sendingRef.current) return;
    const queue = messageQueueRef.current;
    if (queue.length === 0) return;
    // Only the agent's reply (not the human's own next queued message)
    // clears the ball from our court -- draining while still awaiting would
    // fire a second message before the first got a reply.
    if (awaitingRef.current) return;
    const [next, ...rest] = queue;
    // A previously failed item stays at the front and blocks draining until
    // it's removed, so a later reply landing doesn't fire the next item out
    // of order.
    if (blockedQueueIdRef.current === next.id) return;
    messageQueueRef.current = rest;
    setQueuedMessages(rest);
    void sendMessageText(next.content, next.id);
  }, [sendMessageText]);

  const drainQueuedMessageRef = useRef(drainQueuedMessage);
  drainQueuedMessageRef.current = drainQueuedMessage;

  const handleStop = async () => {
    if (!session || !awaiting || stopping) return;
    const targetSessionId = session.id;
    setStopping(true);
    try {
      const res = await fetch(`/api/agent-chat/${targetSessionId}/stop`, { method: "POST" });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to stop agent");
      if (sessionIdRef.current !== targetSessionId) return;
      await loadMessages(targetSessionId);
    } catch (error) {
      if (sessionIdRef.current === targetSessionId) {
        toast.error(error instanceof Error ? error.message : "Failed to stop agent");
      }
    } finally {
      if (sessionIdRef.current === targetSessionId) setStopping(false);
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!session || !text || sendingRef.current) return;
    if (text.length > MAX_MESSAGE_LENGTH) {
      toast.error("Message is too long (8000 characters max)");
      return;
    }
    setDraft("");
    dismissMention();
    composerEditorRef.current?.commands.clearContent();
    composerRef.current?.focus();
    focusComposer();
    if (composerLocked) {
      // Same rationale as the optimistic message id above: this only runs
      // from an event handler, never during render.
      // eslint-disable-next-line react-hooks/purity
      const queued = { id: `queued-${Date.now()}`, content: text };
      messageQueueRef.current = [...messageQueueRef.current, queued];
      setQueuedMessages(messageQueueRef.current);
      return;
    }
    await sendMessageText(text);
  };
  // Stable reference for the palette-command listener below, which shouldn't
  // re-subscribe on every render just because handleSend is a new closure.
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  // Ctrl+Tab / Ctrl+Shift+Tab (and the Alt+ArrowDown/Up fallback, since
  // browsers reserve Ctrl+Tab for switching tabs) step through the currently
  // filtered roster, wrapping around at either end.
  const cycleAgent = useCallback(
    (direction: 1 | -1) => {
      if (roster.length === 0) return;
      const currentIndex = roster.findIndex((a) => a.id === selectedId);
      const nextIndex =
        currentIndex === -1
          ? 0
          : (currentIndex + direction + roster.length) % roster.length;
      selectAgent(roster[nextIndex]);
    },
    [roster, selectedId, selectAgent],
  );

  // Ctrl+O and the palette's "Open all links in latest reply" both need this.
  const openLatestReplyLinks = useCallback(() => {
    const latestWithLinks = [...(messages ?? [])]
      .reverse()
      .find(
        (m) => extractMessageLinks(m.content, projectIdForPrefix).length > 0,
      );
    if (!latestWithLinks) return;
    const links = extractMessageLinks(
      latestWithLinks.content,
      projectIdForPrefix,
    ).slice(0, 5);
    for (const href of links) window.open(href, "_blank", "noopener");
  }, [messages, projectIdForPrefix]);


  return {
    removeQueuedMessage, drainQueuedMessageRef, handleStop, handleSend, handleSendRef, cycleAgent,
    openLatestReplyLinks,
  };
}
