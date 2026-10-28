"use client";

import { type AgentChatActivity } from "@/lib/agents/chatActivityFeed";
import { readDraft, writeDraft } from "@/lib/agents/chatDrafts";
import { markChatRead, saveDraftToServer, } from "@/lib/agents/chatViewerState";
import { useCallback, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import toast from "react-hot-toast";
import type { TAgent } from "../AgentsRegister";
import { TChatMessage, TProposalAction } from "./agentChatTypes";
import type { useAgentChatState } from "./useAgentChatState";

type Props = Pick<
  ReturnType<typeof useAgentChatState>,
  | "embedded"
  | "loadGenRef"
  | "sessionIdRef"
  | "sendingRef"
  | "setSending"
  | "setMessages"
  | "setActivity"
  | "setAwaiting"
  | "setMessagesError"
  | "setDeliveryMode"
  | "setDeliveryNotice"
  | "draftHydratedRef"
  | "draftRef"
  | "setDraft"
  | "selectedIdRef"
  | "currentUser"
  | "setSessionLoading"
  | "setSession"
  | "setSelectedId"
  | "setStopping"
  | "setReplyTimedOut"
  | "dismissMention"
  | "restoredDraftRef"
  | "messageQueueRef"
  | "setQueuedMessages"
  | "isMbl"
  | "composerRef"
  | "focusComposer"
  | "router"
  | "searchParams"
  | "agents"
  | "session"
>;

export function useAgentChatSession({
  embedded, loadGenRef, sessionIdRef, sendingRef, setSending, setMessages, setActivity, setAwaiting, setMessagesError,
  setDeliveryMode, setDeliveryNotice, draftHydratedRef, draftRef, setDraft, selectedIdRef,
  currentUser, setSessionLoading, setSession, setSelectedId, setStopping, setReplyTimedOut,
  dismissMention, restoredDraftRef, messageQueueRef, setQueuedMessages, isMbl, composerRef,
  focusComposer, router, searchParams, agents, session,
}: Props) {
  const activeRef = useRef(!embedded || embedded.active);
  activeRef.current = !embedded || embedded.active;
  const loadMessages = useCallback(async (loadSessionId: string) => {
    const generation = ++loadGenRef.current;
    try {
      const res = await fetch(`/api/agent-chat/${loadSessionId}`, {
        cache: "no-store",
        headers: embedded ? { "x-hypertask-sidebar-project": String(embedded.projectId) } : {},
      });
      const data = (await res.json()) as {
        success?: boolean;
        messages?: TChatMessage[];
        activity?: AgentChatActivity[];
        error?: string;
        chatEnabled?: boolean;
        deliveryMode?: "webhook" | "polling" | null;
        awaiting?: boolean;
        viewer?: { draft: string | null; unreadCount: number } | null;
        sharedConversationEnabled?: boolean;
      };
      if (!res.ok || !data.success || !Array.isArray(data.messages)) {
        throw new Error(data.error ?? "Failed to load messages");
      }
      if (
        sessionIdRef.current !== loadSessionId ||
        sendingRef.current ||
        generation !== loadGenRef.current
      )
        return;
      setMessages(data.messages);
      setActivity(Array.isArray(data.activity) ? data.activity : []);
      setAwaiting(Boolean(data.awaiting));
      setMessagesError(null);
      setDeliveryMode(data.deliveryMode ?? null);
      setDeliveryNotice(data.chatEnabled === false);
      if (data.viewer && draftHydratedRef.current !== loadSessionId) {
        draftHydratedRef.current = loadSessionId;
        const local = draftRef.current;
        const stored = data.viewer?.draft ?? "";
        if (local.trim() !== "") {
          if (local !== stored) saveDraftToServer(loadSessionId, local, embedded?.projectId);
        } else if (stored !== "") {
          draftRef.current = stored;
          setDraft(stored);
          if (selectedIdRef.current)
            writeDraft(currentUser.id, embedded?.draftKey ?? selectedIdRef.current, stored);
        }
      }
      if (activeRef.current && data.viewer && data.viewer.unreadCount > 0) {
        markChatRead(loadSessionId, embedded?.projectId);
      }
    } catch (e) {
      if (
        sessionIdRef.current === loadSessionId &&
        generation === loadGenRef.current
      ) {
        setMessagesError(
          e instanceof Error ? e.message : "Failed to load messages",
        );
      }
    }
  }, [currentUser.id, embedded?.projectId]);

  const handleProposalAction = useCallback<TProposalAction>(
    async (proposalId, action) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) return;
      try {
        const res = await fetch(
          `/api/agent-chat/${activeSessionId}/proposals/${proposalId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(embedded ? { "x-hypertask-sidebar-project": String(embedded.projectId) } : {}) },
            body: JSON.stringify({ action }),
          },
        );
        const data = (await res.json()) as {
          success?: boolean;
          error?: string;
        };
        if (!res.ok || !data.success) {
          toast.error(data.error ?? "Could not update the proposal");
        }
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Could not update the proposal",
        );
      } finally {
        await loadMessages(activeSessionId);
      }
    },
    [loadMessages],
  );

  const openAgentSession = useCallback(
    async (agentId: string) => {
      setSessionLoading(true);
      try {
        const res = await fetch(embedded ? "/api/agent-sidebar-chats" : "/api/ai-chat/create-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId, ...(embedded ? { projectId: embedded.projectId, sessionId: embedded.sessionId } : {}) }),
        });
        const data = (await res.json()) as {
          success?: boolean;
          session?: { id: string };
          error?: string;
        };
        if (!res.ok || !data.success || !data.session) {
          throw new Error(data.error ?? "Could not open chat");
        }
        if (selectedIdRef.current !== agentId) return;
        sessionIdRef.current = data.session.id;
        setSession({ id: data.session.id, agentId });
      } catch (e) {
        if (selectedIdRef.current === agentId) {
          setMessagesError(
            e instanceof Error ? e.message : "Could not open chat",
          );
        }
      } finally {
        if (selectedIdRef.current === agentId) setSessionLoading(false);
      }
    },
    [embedded?.projectId, embedded?.sessionId],
  );

  const clearSelectionState = () => {
    if (selectedIdRef.current) {
      writeDraft(currentUser.id, embedded?.draftKey ?? selectedIdRef.current, draftRef.current);
    }
    selectedIdRef.current = null;
    sessionIdRef.current = null;
    if (embedded) {
      sendingRef.current = false;
      setSending(false);
    }
    draftHydratedRef.current = null;
    setSelectedId(null);
    setSession(null);
    setSessionLoading(false);
    setMessages(null);
    setActivity([]);
    setMessagesError(null);
    setAwaiting(false);
    setStopping(false);
    setDeliveryNotice(false);
    setDeliveryMode(null);
    setReplyTimedOut(false);
    setDraft("");
    dismissMention();
  };

  const selectAgent = useCallback(
    (agent: TAgent) => {
      const leaving = selectedIdRef.current;
      if (leaving && leaving !== agent.id) {
        writeDraft(currentUser.id, embedded?.draftKey ?? leaving, draftRef.current);
      }
      selectedIdRef.current = agent.id;
      sessionIdRef.current = null;
      if (embedded) {
        sendingRef.current = false;
        setSending(false);
      }
      draftHydratedRef.current = null;
      const restored = readDraft(currentUser.id, embedded?.draftKey ?? agent.id);
      draftRef.current = restored;
      restoredDraftRef.current = restored;
      messageQueueRef.current = [];
      const updateSelection = () => {
        setSelectedId(agent.id);
        setSession(null);
        setSessionLoading(false);
        setMessages(null);
        setActivity([]);
        setMessagesError(null);
        setAwaiting(false);
        setStopping(false);
        setDeliveryNotice(false);
        setDeliveryMode(null);
        setReplyTimedOut(false);
        setDraft(restored);
        setQueuedMessages([]);
      };
      if (embedded) updateSelection();
      else flushSync(updateSelection);
      dismissMention();
      if (isMbl && agent.runtimeType === "EXTERNAL") composerRef.current?.focus();
      if (isMbl && agent.runtimeType === "EXTERNAL") focusComposer();
      if (!embedded) router.replace(
        `/agents/chat?agent=${encodeURIComponent(agent.slug ?? agent.id)}`,
        { scroll: false },
      );
      if (agent.runtimeType !== "EXTERNAL") return;
      void openAgentSession(agent.id);
    },
    [router, openAgentSession, isMbl, currentUser.id, embedded?.projectId],
  );

  const agentParam = searchParams?.get("agent") ?? null;
  useEffect(() => {
    if (embedded || !agents || !agentParam || selectedIdRef.current) return;
    const match = agents.find(
      (a) => !a.revokedAt && (a.slug ?? a.id) === agentParam,
    ) ?? agents.find((a) => !a.revokedAt && a.id === agentParam);
    if (match) selectAgent(match);
  }, [agents, agentParam, selectAgent]);

  const sessionName = session?.id ?? null;
  useEffect(() => {
    if (!sessionName) return;
    void loadMessages(sessionName);
  }, [sessionName, loadMessages]);


  return {
    loadMessages, handleProposalAction, clearSelectionState, selectAgent, sessionName,
  };
}
