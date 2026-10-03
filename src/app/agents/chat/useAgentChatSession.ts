"use client";

import { type AgentChatActivity } from "@/lib/agents/chatActivityFeed";
import { readDraft, writeDraft } from "@/lib/agents/chatDrafts";
import { markChatRead, saveDraftToServer, } from "@/lib/agents/chatViewerState";
import { useCallback, useEffect } from "react";
import { flushSync } from "react-dom";
import toast from "react-hot-toast";
import type { TAgent } from "../AgentsRegister";
import { TChatMessage, TProposalAction } from "./agentChatTypes";
import type { useAgentChatState } from "./useAgentChatState";

type Props = Pick<
  ReturnType<typeof useAgentChatState>,
  | "loadGenRef"
  | "sessionIdRef"
  | "sendingRef"
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
  loadGenRef, sessionIdRef, sendingRef, setMessages, setActivity, setAwaiting, setMessagesError,
  setDeliveryMode, setDeliveryNotice, draftHydratedRef, draftRef, setDraft, selectedIdRef,
  currentUser, setSessionLoading, setSession, setSelectedId, setStopping, setReplyTimedOut,
  dismissMention, restoredDraftRef, messageQueueRef, setQueuedMessages, isMbl, composerRef,
  focusComposer, router, searchParams, agents, session,
}: Props) {
  const loadMessages = useCallback(async (loadSessionId: string) => {
    const generation = ++loadGenRef.current;
    try {
      const res = await fetch(`/api/agent-chat/${loadSessionId}`, {
        cache: "no-store",
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
      // Ignore answers for a chat the user already left, never clobber an
      // optimistic send that is still in flight, and drop responses a newer
      // request for the same session has already superseded.
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
      // Same signal a failed send sets: no live delivery path means the human
      // side of the notice must survive a reload.
      setDeliveryNotice(data.chatEnabled === false);
      // First load of this thread: reconcile the two draft copies. Whatever is
      // on this device wins, because it is what was typed most recently here,
      // and it gets pushed up so the next device sees it. An empty device slot
      // takes the server's copy, which is what makes a draft cross devices.
      // Viewer rows exist for private owner chats too; only the shared roster
      // stays behind the flag.
      if (data.viewer && draftHydratedRef.current !== loadSessionId) {
        draftHydratedRef.current = loadSessionId;
        const local = draftRef.current;
        const stored = data.viewer?.draft ?? "";
        if (local.trim() !== "") {
          if (local !== stored) saveDraftToServer(loadSessionId, local);
        } else if (stored !== "") {
          draftRef.current = stored;
          setDraft(stored);
          if (selectedIdRef.current)
            writeDraft(currentUser.id, selectedIdRef.current, stored);
        }
      }
      // Reading the newest page is catching up, so the unread marker moves.
      if (data.viewer && data.viewer.unreadCount > 0) {
        markChatRead(loadSessionId);
      }
      // Draining here would read awaitingRef before the render that follows
      // this setMessages has run, so it'd still see the stale (pre-reply)
      // value. The effect below (keyed on the derived `awaiting`) is the one
      // place that's guaranteed to observe the committed state instead.
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
  }, [currentUser.id]);

  // Confirm or dismiss a proposed ticket. The server owns the decision; this
  // just refetches so every tab lands on the state the server committed.
  const handleProposalAction = useCallback<TProposalAction>(
    async (proposalId, action) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) return;
      try {
        const res = await fetch(
          `/api/agent-chat/${activeSessionId}/proposals/${proposalId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
        // One ongoing thread per agent: the route upserts, so re-selecting an
        // agent always lands on the same conversation.
        const res = await fetch("/api/ai-chat/create-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId }),
        });
        const data = (await res.json()) as {
          success?: boolean;
          session?: { id: string };
          error?: string;
        };
        if (!res.ok || !data.success || !data.session) {
          throw new Error(data.error ?? "Could not open chat");
        }
        // The user may have switched agents while this was in flight.
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
    [],
  );

  const clearSelectionState = () => {
    // Leaving the chat is not the same as discarding the message: keep it for
    // when this agent is opened again.
    if (selectedIdRef.current) {
      writeDraft(currentUser.id, selectedIdRef.current, draftRef.current);
    }
    selectedIdRef.current = null;
    sessionIdRef.current = null;
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
      // Read the outgoing agent off the ref before it is overwritten, or the
      // draft lands under the agent being switched to.
      const leaving = selectedIdRef.current;
      if (leaving && leaving !== agent.id) {
        writeDraft(currentUser.id, leaving, draftRef.current);
      }
      selectedIdRef.current = agent.id;
      sessionIdRef.current = null;
      draftHydratedRef.current = null;
      // draftRef is normally refreshed by a passive effect, which can lag
      // behind two switches in the same task (holding Ctrl+Tab). Setting it
      // here means the next switch always writes the draft it actually left.
      const restored = readDraft(currentUser.id, agent.id);
      draftRef.current = restored;
      restoredDraftRef.current = restored;
      // A queued follow-up belongs to the chat it was typed in, not whatever
      // agent gets selected next.
      messageQueueRef.current = [];
      // flushSync (rather than the normal batched update) commits the chat
      // pane, composer included, before this handler returns, so the
      // composerRef.focus() below still runs inside the tap's call stack --
      // mobile browsers only open the keyboard for a focus() that happens
      // synchronously in the user gesture (HTPR-6041 follow-up).
      flushSync(() => {
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
        // This same path runs for a reload (the ?agent= effect calls it), so
        // restoring here covers both switching agents and coming back.
        setDraft(restored);
        setQueuedMessages([]);
      });
      dismissMention();
      if (isMbl && agent.runtimeType === "EXTERNAL") composerRef.current?.focus();
      if (isMbl && agent.runtimeType === "EXTERNAL") focusComposer();
      // The selection lives in the URL so a reload keeps the chat open.
      router.replace(
        `/agents/chat?agent=${encodeURIComponent(agent.slug ?? agent.id)}`,
        { scroll: false },
      );
      // Native agents are chatted with from the full AI chat surface; only
      // external ones get an in-pane session.
      if (agent.runtimeType !== "EXTERNAL") return;
      void openAgentSession(agent.id);
    },
    [router, openAgentSession, isMbl, currentUser.id],
  );

  // Honor ?agent=<slug> once the roster is in (deep link, reload, palette).
  // The raw id resolves too: links written server side (a confirmed proposal's
  // ticket, for one) have no slug to hand.
  const agentParam = searchParams?.get("agent") ?? null;
  useEffect(() => {
    if (!agents || !agentParam || selectedIdRef.current) return;
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
