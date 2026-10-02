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
  selectedAgent, openingFullChat, setOpeningFullChat, router, setDetailsCollapsed,
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
        // Best effort only; the toggle still works for this visit.
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
      // Store the token the moment the agent exists, before the roster
      // refresh below: the endpoint never returns it again, so a refresh
      // failure must not be able to take it down with it.
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
        // The agent was created (and its token, if any, is already shown);
        // a failed roster refresh just means it won't appear in the list
        // until the next reload, not that creation itself failed.
      }
    } catch (e) {
      setCreateAgentError(
        e instanceof Error ? e.message : "Could not create agent",
      );
    } finally {
      setCreatingAgent(false);
    }
  };

  // Any of the three keyboard shortcuts below would otherwise fire while a
  // popover, the create-agent modal, or the mobile details sheet is open and
  // stomp on typing/navigation inside it.
  const overlayOpen = mentionOpen || showCreateAgent || detailsSheetOpen;

  useEffect(() => {
    draftRef.current = draft;
    // Sending empties the composer, which clears the stored draft through the
    // same write; a failed send puts the text back and re-saves it.
    if (selectedId) writeDraft(currentUser.id, selectedId, draft);
    // Only once the server copy has been folded in: writing before that would
    // push this thread's empty composer over a draft typed on another device.
    const activeSessionId = sessionIdRef.current;
    if (activeSessionId && draftHydratedRef.current === activeSessionId) {
      saveDraftToServer(activeSessionId, draft);
    }
  }, [draft, selectedId, currentUser.id]);

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (overlayOpen) return;
      const isCycleKey =
        (e.ctrlKey && e.key === "Tab") ||
        // Excludes Shift: Alt+Shift+Arrow is the app-wide team-cycle
        // shortcut (GloablProviders.tsx) and must not also fire this.
        (e.altKey && !e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp"));
      if (isCycleKey) {
        // A focused control other than the composer (the team filter
        // <select>, a button, a search input) owns Alt+Arrow for its own
        // native navigation; only the composer and the page background are
        // fair game for the roster-cycle shortcut.
        const target = e.target;
        if (
          target instanceof HTMLElement &&
          target !== composerRef.current &&
          ["SELECT", "INPUT", "TEXTAREA", "BUTTON"].includes(target.tagName)
        ) {
          return;
        }
        // Don't fire while the user is mid-edit in the composer: an Alt+Arrow
        // meant to move the cursor, or a stray Ctrl+Tab, would yank them to
        // another agent instead. Text merely restored on selection doesn't
        // count -- drafts now survive the switch, so cycling past a saved one
        // costs nothing and blocking on it would disable the shortcut for as
        // long as the draft sits there (HTPR-6005 review). Reads refs (not
        // `draft` directly) so this effect doesn't need to re-run, and re-add
        // the window listener, on every keystroke.
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
      // Ctrl+O otherwise opens the browser's file picker.
      if (e.ctrlKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openLatestReplyLinks();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlayOpen, cycleAgent, openLatestReplyLinks]);

  // Ctrl+K palette bridge: the "Agent Chat" command group (AllCommands.ts,
  // only shown while this page is open) dispatches these instead of trying
  // to reach into this component's state from the palette's dispatcher.
  useEffect(() => {
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

  // Put the cursor in the composer the moment it becomes usable: on initial
  // load (deep link or roster click) and again after a message sends, so
  // typing can continue without reaching for the mouse.
  useEffect(() => {
    if (isExternal && session && !composerLocked) composerRef.current?.focus();
    if (isExternal && session && !composerLocked) focusComposer();
  }, [isExternal, session, composerLocked, selectedId]);


  return {
    handleOpenFullChat, toggleDetails, backToRoster, createAgent,
  };
}
