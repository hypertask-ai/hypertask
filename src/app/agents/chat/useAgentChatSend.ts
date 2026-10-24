"use client";

import { extractMessageLinks } from "@/lib/agents/messageLinks";
import { useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { useRecoilValue } from "@/lib/state";
import { currentProjectAtom, inViewObjectAtom } from "@/store";
import { useDockedChatScope } from "@/hooks/MultiPages/AIChat/useDockedChatScope";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7734_AGENT_CHAT_CONTEXT_FLAG } from "@/lib/flags/definitions/htpr-7734-agent-chat-context";
import type { AgentChatContext } from "./agentChatTypes";
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
  | "embedded"
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
  embedded, sessionIdRef, selectedIdRef, setDeliveryNotice, setAwaiting, setReplyTimedOut, setAwaitingSince,
  setMessages, sendingRef, setSending, setAgents, blockedQueueIdRef, messageQueueRef,
  setQueuedMessages, setDraft, liveSortEnabled, awaitingRef, session, awaiting, stopping,
  setStopping, loadMessages, draft, dismissMention, composerEditorRef, composerRef, focusComposer,
  composerLocked, roster, selectedId, selectAgent, messages, projectIdForPrefix,
}: Props) {
  const contextEnabled = useFlag(HTPR_7734_AGENT_CHAT_CONTEXT_FLAG);
  const [scope] = useDockedChatScope();
  const currentProject = useRecoilValue(currentProjectAtom);
  const inViewObject = useRecoilValue(inViewObjectAtom);
  const pathname = usePathname();
  const ticketSelected = scope === "ticket" && pathname?.startsWith("/detail") && !!inViewObject?.taskId;
  const context: AgentChatContext | undefined = contextEnabled && embedded ? {
    project_id: ticketSelected ? inViewObject.taskProjectId ?? currentProject?.id ?? embedded.projectId
      : typeof scope === "number" ? scope : scope === "all" ? undefined : currentProject?.id ?? embedded.projectId,
    ...(ticketSelected ? { task_id: inViewObject.taskId, scope: "ticket" } : {}),
    surface_path: pathname ?? undefined,
  } : undefined;
  const sendMessageText = useCallback(async (text: string, queuedId?: string, messageContext?: AgentChatContext) => {
    const targetSessionId = sessionIdRef.current;
    const targetAgentId = selectedIdRef.current;
    if (!targetSessionId) return;
    const optimistic: TChatMessage = {

      id: `optimistic-${Date.now()}`,
      role: "human",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setDeliveryNotice(false);
    setAwaiting(true);
    setReplyTimedOut(false);
    setAwaitingSince(null);
    setMessages((prev) => [...(prev ?? []), optimistic]);
    sendingRef.current = true;
    setSending(true);
    try {
      const res = await fetch(`/api/agent-chat/${targetSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(embedded ? { "x-hypertask-sidebar-project": String(embedded.projectId) } : {}) },
        body: JSON.stringify({ text, ...(contextEnabled && embedded && messageContext ? { default_context: messageContext } : {}) }),
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
      if (targetAgentId) {
        setAgents((prev) =>
          bumpRosterChatRecency(
            prev,
            targetAgentId,
            sentMessage.createdAt ?? new Date().toISOString(),
          ),
        );
      }
      if (data.delivered === false) setDeliveryNotice(true);
    } catch (e) {
      if (sessionIdRef.current !== targetSessionId) return;
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== optimistic.id));
      if (queuedId) {
        blockedQueueIdRef.current = queuedId;
        messageQueueRef.current = [{ id: queuedId, content: text, ...(messageContext ? { context: messageContext } : {}) }, ...messageQueueRef.current];
        setQueuedMessages(messageQueueRef.current);
      } else {
        setAwaiting(false);
        setDraft(text);
      }
      toast.error(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      if (!embedded || sessionIdRef.current === targetSessionId) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  }, [liveSortEnabled, embedded?.projectId, contextEnabled]);

  const removeQueuedMessage = useCallback((id: string) => {
    messageQueueRef.current = messageQueueRef.current.filter(
      (item) => item.id !== id,
    );
    setQueuedMessages(messageQueueRef.current);
    if (blockedQueueIdRef.current === id) blockedQueueIdRef.current = null;
  }, []);

  const drainQueuedMessage = useCallback(() => {
    if (sendingRef.current) return;
    const queue = messageQueueRef.current;
    if (queue.length === 0) return;
    if (awaitingRef.current) return;
    const [next, ...rest] = queue;
    if (blockedQueueIdRef.current === next.id) return;
    messageQueueRef.current = rest;
    setQueuedMessages(rest);
    void sendMessageText(next.content, next.id, next.context);
  }, [sendMessageText]);

  const drainQueuedMessageRef = useRef(drainQueuedMessage);
  drainQueuedMessageRef.current = drainQueuedMessage;

  const handleStop = async () => {
    if (!session || !awaiting || stopping) return;
    const targetSessionId = session.id;
    setStopping(true);
    try {
      const res = await fetch(`/api/agent-chat/${targetSessionId}/stop`, { method: "POST", headers: embedded ? { "x-hypertask-sidebar-project": String(embedded.projectId) } : {} });
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

      const queued = { id: `queued-${Date.now()}`, content: text, ...(context ? { context } : {}) };
      messageQueueRef.current = [...messageQueueRef.current, queued];
      setQueuedMessages(messageQueueRef.current);
      return;
    }
    await sendMessageText(text, undefined, context);
  };
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

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
