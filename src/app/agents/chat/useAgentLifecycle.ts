"use client";

import { writeDraft } from "@/lib/agents/chatDrafts";
import { AGENT_CHAT_COMMAND_EVENT, type TAgentChatCommand, } from "@/lib/agents/chatPaletteCommands";
import { saveDraftToServer } from "@/lib/agents/chatViewerState";
import { useEffect } from "react";
import toast from "react-hot-toast";
import { DETAILS_COLLAPSED_KEY } from "./agentChatTypes";
import type { useAgentChatFeed } from "./useAgentChatFeed";
import type { useAgentChatNavigation } from "./useAgentChatNavigation";
import type { useAgentChatRoster } from "./useAgentChatRoster";
import type { useAgentChatSend } from "./useAgentChatSend";
import type { useAgentChatSession } from "./useAgentChatSession";
import type { useAgentChatState } from "./useAgentChatState";

type Props = Pick<
  ReturnType<typeof useAgentChatNavigation>,
  | "selectedAgent"
  | "stepTeamCycle"
  | "isExternal"
> &
  Pick<
  ReturnType<typeof useAgentChatState>,
  | "embedded"
  | "openingFullChat"
  | "setOpeningFullChat"
  | "router"
  | "setDetailsCollapsed"
  | "newAgentName"
  | "creatingAgent"
  | "setCreatingAgent"
  | "setCreateAgentError"
  | "setNewAgentToken"
  | "setShowCreateAgent"
  | "setNewAgentName"
  | "rosterGenRef"
  | "setAgents"
  | "setRosterError"
  | "mentionOpen"
  | "showCreateAgent"
  | "detailsSheetOpen"
  | "draftRef"
  | "draft"
  | "selectedId"
  | "currentUser"
  | "sessionIdRef"
  | "draftHydratedRef"
  | "composerRef"
  | "restoredDraftRef"
  | "composerEditorRef"
  | "session"
  | "focusComposer"
> &
  Pick<
  ReturnType<typeof useAgentChatSession>,
  | "clearSelectionState"
  | "selectAgent"
> &
  Pick<
  ReturnType<typeof useAgentChatRoster>,
  | "loadAgents"
> &
  Pick<
  ReturnType<typeof useAgentChatSend>,
  | "cycleAgent"
  | "openLatestReplyLinks"
  | "handleSendRef"
> &
  Pick<
  ReturnType<typeof useAgentChatFeed>,
  | "composerLocked"
>;

export function useAgentLifecycle({
  embedded, selectedAgent, openingFullChat, setOpeningFullChat, router, setDetailsCollapsed,
  clearSelectionState, newAgentName, creatingAgent, setCreatingAgent, setCreateAgentError,
  setNewAgentToken, setShowCreateAgent, setNewAgentName, rosterGenRef, loadAgents, setAgents,
  setRosterError, selectAgent, mentionOpen, showCreateAgent, detailsSheetOpen, draftRef, draft,
  selectedId, currentUser, sessionIdRef, draftHydratedRef, composerRef, restoredDraftRef,
  composerEditorRef, cycleAgent, openLatestReplyLinks, handleSendRef, stepTeamCycle, isExternal,
  session, composerLocked, focusComposer,
}: Props) {
  const handleOpenFullChat = async () => {
    if (!selectedAgent || openingFullChat) return;
    setOpeningFullChat(true);
    try {
      const res = await fetch("/api/ai-chat/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: selectedAgent.id }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        session?: { id: string };
        error?: string;
      };
      if (!res.ok || !data.success || !data.session) {
        throw new Error(data.error ?? "Could not open agent chat");
      }
      router.push(`/chat/${data.session.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open agent chat");
      setOpeningFullChat(false);
    }
  };

  const toggleDetails = () => {
    setDetailsCollapsed((prev) => {
      try {
        window.localStorage.setItem(DETAILS_COLLAPSED_KEY, prev ? "0" : "1");
      } catch {
      }
      return !prev;
    });
  };

  const backToRoster = () => {
    clearSelectionState();
    router.replace("/agents/chat", { scroll: false });
  };

  const createAgent = async () => {
    const displayName = newAgentName.trim();
    if (!displayName || creatingAgent) return;
    setCreatingAgent(true);
    setCreateAgentError(null);
    try {
      const res = await fetch("/api/mcp/admin/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        agent?: { id: string };
        token?: string;
        error?: string;
      };
      if (!res.ok || !data.success || !data.agent) {
        throw new Error(data.error ?? "Could not create agent");
      }
      const createdId = data.agent.id;
      if (data.token) {
        setNewAgentToken(data.token);
      } else {
        setShowCreateAgent(false);
        setNewAgentName("");
      }
      try {
        const myGen = ++rosterGenRef.current;
        const refreshed = await loadAgents();
        if (myGen === rosterGenRef.current) {
          setAgents(refreshed);
          setRosterError(null);
          const created = refreshed.find((a) => a.id === createdId);
          if (created) selectAgent(created);
        }
      } catch {
      }
    } catch (e) {
      setCreateAgentError(
        e instanceof Error ? e.message : "Could not create agent",
      );
    } finally {
      setCreatingAgent(false);
    }
  };

  const overlayOpen = mentionOpen || showCreateAgent || detailsSheetOpen;

  useEffect(() => {
    draftRef.current = draft;
    if (selectedId) writeDraft(currentUser.id, selectedId, draft);
    const activeSessionId = sessionIdRef.current;
    if (activeSessionId && draftHydratedRef.current === activeSessionId) {
      saveDraftToServer(activeSessionId, draft, embedded?.projectId);
    }
  }, [draft, selectedId, currentUser.id, embedded?.projectId]);

  useEffect(() => {
    if (embedded) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (overlayOpen) return;
      const isCycleKey =
        (e.ctrlKey && e.key === "Tab") ||
        (e.altKey && !e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp"));
      if (isCycleKey) {
        const target = e.target;
        if (
          target instanceof HTMLElement &&
          target !== composerRef.current &&
          ["SELECT", "INPUT", "TEXTAREA", "BUTTON"].includes(target.tagName)
        ) {
          return;
        }
        if (
          document.activeElement === composerRef.current &&
          draftRef.current.trim() !== "" &&
          draftRef.current !== restoredDraftRef.current
        ) {
          return;
        }
        if (
          composerEditorRef.current?.isFocused &&
          draftRef.current.trim() !== "" &&
          draftRef.current !== restoredDraftRef.current
        ) {
          return;
        }
        e.preventDefault();
        const direction = e.key === "Tab" ? (e.shiftKey ? -1 : 1) : e.key === "ArrowDown" ? 1 : -1;
        cycleAgent(direction);
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openLatestReplyLinks();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlayOpen, cycleAgent, openLatestReplyLinks]);

  useEffect(() => {
    if (embedded) return;
    const onPaletteCommand = (e: Event) => {
      const detail = (e as CustomEvent<TAgentChatCommand>).detail;
      switch (detail) {
        case "next-agent":
          cycleAgent(1);
          return;
        case "previous-agent":
          cycleAgent(-1);
          return;
        case "send-message":
          void handleSendRef.current();
          return;
        case "open-links":
          openLatestReplyLinks();
          return;
        case "add-agent":
          setShowCreateAgent(true);
          return;
        case "next-team":
          stepTeamCycle(1);
          return;
        case "previous-team":
          stepTeamCycle(-1);
          return;
      }
    };
    window.addEventListener(AGENT_CHAT_COMMAND_EVENT, onPaletteCommand);
    return () =>
      window.removeEventListener(AGENT_CHAT_COMMAND_EVENT, onPaletteCommand);
  }, [cycleAgent, openLatestReplyLinks, stepTeamCycle]);

  useEffect(() => {
    if (embedded) return;
    if (isExternal && session && !composerLocked) composerRef.current?.focus();
    if (isExternal && session && !composerLocked) focusComposer();
  }, [isExternal, session, composerLocked, selectedId]);


  return {
    handleOpenFullChat, toggleDetails, backToRoster, createAgent,
  };
}
