"use client";

import { HTPR_7737_AGENT_HOVER_CHAT_FLAG } from "@/lib/flags/definitions/htpr-7737-agent-hover-chat";
import { HTPR_8048_AGENT_SESSIONS_FLAG } from "@/lib/flags/definitions/htpr-8048-agent-sessions";
import { HTPR_7766_CHAT_SHORTCUTS_FLAG } from "@/lib/flags/definitions/htpr-7766-chat-shortcuts";

import { useChatShortcuts } from "@/hooks/MultiPages/AIChat/useChatShortcuts";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7800_SKILL_RUNS_IN_SIDEBAR_FLAG } from "@/lib/flags/definitions/htpr-7800-skill-runs-in-sidebar";
import { HTPR_7688_PAST_CHATS_FIRST_FLAG } from "@/lib/flags/definitions/htpr-7688-past-chats-first";
import { HTPR_7318_TICKET_CHAT_REMINDER_FLAG } from "@/lib/flags/definitions/htpr-7318-ticket-chat-reminder";
import { HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG } from "@/lib/flags/keys";
import AgentChatClient from "@/app/agents/chat/AgentChatClient";
import type { TAgent } from "@/app/agents/AgentsRegister";
import type { SidebarChatAgent, SidebarChatTarget } from "@/app/agents/chat/agentChatTypes";
import { readDraft, writeDraft } from "@/lib/agents/chatDrafts";
import { getNativeSidebarChat, setNativeSidebarChat } from "@/lib/agents/chatViewerState";
import { AI_Chat_API } from "@/utils/api/ai_chat/aiChatHelpers";
import { currentProjectAtom, currentUserAtom } from "@/store";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { MessageList } from "./MessageList";
import { WelcomeScreen } from "./WelcomeScreen";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { ChatHeader } from "./ChatHeader";
import { AI_Tiptap_Container } from "./AI_Tiptap_Container";
import { AiChatSidebarResizeHandle } from "./AiChatSidebarResizeHandle";
import { aiChatSidebarWidthPxAtom } from "@/store";
import { AI_CHAT_SIDEBAR_MIN_PX } from "@/lib/configs/style.config";
import { cn } from "@/utils/undoActions/helperFuncs";

export const AI_Chat_Sidebar = ({
  inOffcanvas = false,
}: {
  inOffcanvas?: boolean;
}) => {
  const sharedShortcutsEnabled = useFlag(HTPR_7766_CHAT_SHORTCUTS_FLAG);
  const chat = useAiChatContext();
  const { showWelcomeScreen, minimized } = chat;
  const agentSessionsEnabled = useFlag(HTPR_8048_AGENT_SESSIONS_FLAG);
  const agentHoverChat = useFlag(HTPR_7737_AGENT_HOVER_CHAT_FLAG);
  const enabled = useFlag(HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG);
  const pastChatsFirst = useFlag(HTPR_7688_PAST_CHATS_FIRST_FLAG);
  const ticketChatReminder = useFlag(HTPR_7318_TICKET_CHAT_REMINDER_FLAG);
  const skillRunsInSidebar = useFlag(HTPR_7800_SKILL_RUNS_IN_SIDEBAR_FLAG);
  const project = useRecoilValue(currentProjectAtom);
  const currentUser = useRecoilValue(currentUserAtom);
  const projectId = project?.id;
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [target, setTarget] = useState<SidebarChatTarget>({ kind: "ai" });
  const [agents, setAgents] = useState<SidebarChatAgent[]>([]);
  const [visited, setVisited] = useState<SidebarChatAgent[]>([]);
  const [routedDraft, setRoutedDraft] = useState<{ sessionId: string; text: string; requestId: number } | null>(null);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const rosterProject = useRef<number | null>(null);
  const lastAgentSessions = useRef(new Map<string, string>());
  const [rosterError, setRosterError] = useState<string | null>(null);
  const intentRef = useRef(0);
  const rosterGeneration = useRef(0);
  const aiSessionRef = useRef<string | null>(null);
  const resolvingGeneralChat = useRef(false);
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const targetRef = useRef(target);
  targetRef.current = target;
  const generalChatPending = enabled && !!projectId && target.kind === "ai" && !!chat.currentSession?.agentId;
  const drafts = useRef(new Map<string, { html: string; files: typeof chat.fileItems }>());
  const sidebarEnabled = enabled && !!projectId && !!currentUser;

  const loadRoster = useCallback(async () => {
    if (!enabled || !projectId) return;
    const generation = ++rosterGeneration.current;
    try {
      const response = await fetch(`/api/agent-sidebar-chats?projectId=${projectId}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.agents)) throw new Error(data.error ?? "Could not load agents");
      if (generation !== rosterGeneration.current) return;
      const refreshed: SidebarChatAgent[] = data.agents;
      if (agentSessionsEnabled) for (const agent of refreshed) {
        const loadedCount = agentsRef.current.find((previous) => previous.id === agent.id)?.sessions?.length ?? 0;
        while (agent.hasMoreSessions && (agent.sessions?.length ?? 0) < loadedCount) {
          const before = agent.sessions?.at(-1)?.id;
          if (!before) break;
          const olderResponse = await fetch(`/api/agent-sidebar-chats?projectId=${projectId}&agentId=${encodeURIComponent(agent.id)}&before=${encodeURIComponent(before)}`, { cache: "no-store" });
          const olderData = await olderResponse.json();
          if (!olderResponse.ok || !olderData.success || !Array.isArray(olderData.agents)) throw new Error("Could not refresh older sessions");
          if (generation !== rosterGeneration.current) return;
          const page: SidebarChatAgent | undefined = olderData.agents.find((item: SidebarChatAgent) => item.id === agent.id);
          if (!page) throw new Error("Agent sessions unavailable");
          const merged = [...new Map([...(agent.sessions ?? []), ...(page.sessions ?? [])].map((session) => [session.id, session])).values()];
          if (merged.length <= (agent.sessions?.length ?? 0)) break;
          agent.sessions = merged;
          agent.hasMoreSessions = page.hasMoreSessions;
        }
      }
      rosterProject.current = projectId;
      setAgents(refreshed);
      setRosterError(null);
    } catch (error) {
      if (generation !== rosterGeneration.current) return;
      setAgents([]);
      setRosterError(error instanceof Error ? error.message : "Could not load agents");
    }
  }, [enabled, projectId, agentSessionsEnabled]);

  const loadingAgentPages = useRef(new Set<string>());
  const loadMoreAgentSessions = async (agent: SidebarChatAgent) => {
    const before = agent.sessions?.at(-1)?.id;
    if (!agentSessionsEnabled || !projectId || !before || !agent.hasMoreSessions || loadingAgentPages.current.has(agent.id)) return;
    const generation = rosterGeneration.current;
    loadingAgentPages.current.add(agent.id);
    try {
      const response = await fetch(`/api/agent-sidebar-chats?projectId=${projectId}&agentId=${encodeURIComponent(agent.id)}&before=${encodeURIComponent(before)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.agents)) throw new Error(data.error ?? "Could not load older sessions");
      if (generation !== rosterGeneration.current) return;
      const page: SidebarChatAgent | undefined = data.agents.find((item: SidebarChatAgent) => item.id === agent.id);
      if (!page) throw new Error("Agent sessions unavailable");
      setAgents((previous) => previous.map((item) => item.id === agent.id ? {
        ...item, hasMoreSessions: page.hasMoreSessions,
        sessions: [...new Map([...(item.sessions ?? []), ...(page.sessions ?? [])].map((session) => [session.id, session])).values()],
      } : item));
      setRosterError(null);
    } catch (error) {
      if (generation === rosterGeneration.current) setRosterError(error instanceof Error ? error.message : "Could not load older sessions");
    } finally { loadingAgentPages.current.delete(agent.id); }
  };

  const selectTarget = async (next: SidebarChatTarget, aiSessionId?: string, options?: { createFallbackSession?: boolean; sessionId?: string; newSession?: boolean; getMentionDraft?: () => { html: string; text: string } }) => {
    const intent = ++intentRef.current;
    if (next.kind !== "ai" && !sidebarEnabled) return;
    let nativeSessionId: string | null = null;
    if (next.kind === "native-agent" || (agentSessionsEnabled && next.kind === "external-agent")) {
      const agentId = next.agent.id;
      try {
        const response = await fetch("/api/agent-sidebar-chats", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, agentId: next.agent.id, ...(agentSessionsEnabled ? { sessionId: options?.sessionId, newSession: options?.newSession } : {}) }) });
        const data = await response.json();
        if (!response.ok || !data.success || !data.session?.id) throw new Error(data.error ?? "Could not open chat");
        if (intent !== intentRef.current) return;
        if (target.kind !== "native-agent" && !chat.currentSession?.agentId) aiSessionRef.current = chat.currentSession?.id ?? null;
        if (next.kind === "native-agent") await AI_Chat_API.getSessionTranscript(data.session.id, undefined, projectId);
        await queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
        if (intent !== intentRef.current) return;
        if (next.kind === "native-agent") nativeSessionId = data.session.id;
        if (agentSessionsEnabled) next = { ...next, agent: { ...next.agent, sessionId: data.session.id,
          draftKey: options?.newSession || (options?.sessionId && options.sessionId !== agents.find((agent) => agent.id === agentId)?.sessionId) ? `${agentId}:${data.session.id}` : undefined } };
        if (options?.newSession) void loadRoster();
      } catch (error) {
        if (intent !== intentRef.current) return;
        const message = error instanceof Error ? error.message : "Could not open chat";
        setRosterError(message);
        if (agentSessionsEnabled) toast.error(message);
        return;
      }
    } else if (options?.createFallbackSession !== false && target.kind === "native-agent" && !aiSessionRef.current && !aiSessionId) {
      setNativeSidebarChat(null);
      await chat.startNewSession();
    }
    if (intent !== intentRef.current) return;
    if (agentSessionsEnabled) setRosterError(null);
    const mentionDraft = options?.getMentionDraft?.();
    const latest = chatRef.current;
    const leaving = targetRef.current;
    if (leaving.kind !== "external-agent") {
      const key = leaving.kind === "native-agent" ? (leaving.agent.draftKey ?? leaving.agent.id) : "ai";
      drafts.current.set(key, { html: latest.editor?.getHTML() ?? "", files: [...latest.fileItems] });
      if (leaving.kind === "native-agent") writeDraft(currentUser.id, leaving.agent.draftKey ?? leaving.agent.id, latest.editor?.getText() ?? "");
    }
    if (aiSessionId) {
      setTarget(next);
      setNativeSidebarChat(null);
      latest.selectSession(aiSessionId);
      aiSessionRef.current = aiSessionId;
    } else {
      if (nativeSessionId) {
        setNativeSidebarChat({ sessionId: nativeSessionId, projectId: projectId! });
        latest.selectSession(nativeSessionId);
      } else {
        setNativeSidebarChat(null);
        if (leaving.kind === "native-agent" && aiSessionRef.current) latest.selectSession(aiSessionRef.current);
      }
      setTarget(next);
    }
    if (agentSessionsEnabled) {
      if (next.kind !== "ai" && next.agent.sessionId) lastAgentSessions.current.set(next.agent.id, next.agent.sessionId);
      try {
        const storageKey = `agentChat.sidebar.${currentUser.id}.${projectId}`;
        if (next.kind === "ai") sessionStorage.removeItem(storageKey);
        else sessionStorage.setItem(storageKey, JSON.stringify({ agentId: next.agent.id, sessionId: next.agent.sessionId }));
      } catch {}
    }
    setRoutedDraft(next.kind === "external-agent" && next.agent.sessionId && mentionDraft ? { sessionId: next.agent.sessionId, text: mentionDraft.text, requestId: intent } : null);
    if (next.kind === "external-agent") {
      if (leaving.kind === "native-agent") {
        const stored = drafts.current.get("ai");
        latest.editor?.commands.setContent(stored?.html ?? "", { emitUpdate: false });
        latest.resetFiles(stored?.files ?? []);
      }
      const selectedAgent = next.agent;
      setVisited((previous) => previous.some((agent) => agent.id === selectedAgent.id && agent.sessionId === selectedAgent.sessionId) ? previous : [...previous, selectedAgent]);
      if (mentionDraft) writeDraft(currentUser.id, selectedAgent.draftKey ?? selectedAgent.id, mentionDraft.text);
    } else {
      const stored = drafts.current.get(next.kind === "native-agent" ? (next.agent.draftKey ?? next.agent.id) : "ai") ??
        (next.kind === "native-agent" ? { html: readDraft(currentUser.id, next.agent.draftKey ?? next.agent.id), files: [] } : undefined);
      latest.editor?.commands.setContent(mentionDraft?.html ?? stored?.html ?? "", { emitUpdate: false });
      latest.resetFiles(stored?.files ?? []);
    }
  };
  const restoredSelection = useRef(false);
  useEffect(() => { restoredSelection.current = false; }, [projectId, currentUser?.id]);
  useEffect(() => {
    if (!agentSessionsEnabled || !sidebarEnabled || rosterProject.current !== projectId || !agents.length || restoredSelection.current) return;
    restoredSelection.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(`agentChat.sidebar.${currentUser.id}.${projectId}`) ?? "null");
      const agent = agents.find((item) => item.id === saved?.agentId);
      if (agent && typeof saved.sessionId === "string" && saved.sessionId) {
        void selectTargetRef.current({ kind: agent.runtimeType === "EXTERNAL" ? "external-agent" : "native-agent", agent }, undefined, { sessionId: saved.sessionId });
      }
    } catch {}
  }, [agentSessionsEnabled, sidebarEnabled, agents, currentUser?.id, projectId]);
  const deepLink = searchParams?.get("sidebarAgent");
  const handledDeepLink = useRef<string | null>(null);
  useEffect(() => {
    if ((!agentSessionsEnabled && !agentHoverChat) || !sidebarEnabled) return;
    const choose = (event: Event) => {
      const detail = (event as CustomEvent<{ agentId: string | null; getDraft?: () => { html: string; text: string } }>).detail;
      if (detail.agentId === null) { void selectTargetRef.current({ kind: "ai" }); return; }
      const agent = agents.find((item) => item.id === detail.agentId);
      if (agent) {
        handledDeepLink.current = agent.id;
        void selectTargetRef.current({ kind: agent.runtimeType === "EXTERNAL" ? "external-agent" : "native-agent", agent }, undefined, { sessionId: lastAgentSessions.current.get(agent.id), getMentionDraft: detail.getDraft });
      }
    };
    window.addEventListener("ht-sidebar-agent-selected", choose);
    return () => window.removeEventListener("ht-sidebar-agent-selected", choose);
  }, [agentSessionsEnabled, agentHoverChat, sidebarEnabled, agents]);
  const shortcuts = useChatShortcuts({
    enabled: sharedShortcutsEnabled,
    active: target.kind !== "external-agent",
    onNewChat: async () => {
      resolvingGeneralChat.current = true;
      try {
        await selectTarget({ kind: "ai" }, undefined, { createFallbackSession: false });
        await chat.startNewSession();
      } finally {
        resolvingGeneralChat.current = false;
      }
    },
    onSelectSession: (id) => { void selectTarget({ kind: "ai" }, id); },
  });
  const selectTargetRef = useRef(selectTarget);
  selectTargetRef.current = selectTarget;

  useEffect(ticketChatReminder || skillRunsInSidebar ? () => {
    const resumeTicketChat = (event: Event) => {
      event.preventDefault();
      const sessionId = (event as CustomEvent<{ sessionId: string }>).detail.sessionId;
      void selectTargetRef.current({ kind: "ai" }, sessionId);
    };
    window.addEventListener("ht-ticket-chat-resume", resumeTicketChat);
    return () => window.removeEventListener("ht-ticket-chat-resume", resumeTicketChat);
  } : () => {}, [ticketChatReminder, skillRunsInSidebar]);

  useEffect(() => {
    if (!generalChatPending || resolvingGeneralChat.current) return;
    if (pastChatsFirst && aiSessionRef.current) return;
    resolvingGeneralChat.current = true;
    void chat.startNewSession().catch((error) => {
      setRosterError(error instanceof Error ? error.message : "Could not open AI chat");
    }).finally(() => { resolvingGeneralChat.current = false; });
  }, [generalChatPending, chat.currentSession?.id]);

  useEffect(() => {
    if (!sidebarEnabled) return;
    void loadRoster();
    const refresh = () => { if (document.visibilityState === "visible") void loadRoster(); };
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { ++rosterGeneration.current; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [sidebarEnabled, loadRoster]);

  useEffect(() => {
    ++intentRef.current;
    setNativeSidebarChat(null);
    setTarget({ kind: "ai" });
    setVisited([]);
    setRoutedDraft(null);
    lastAgentSessions.current.clear();
    setAgents([]);
    aiSessionRef.current = null;
    drafts.current.clear();
    return () => {
      ++intentRef.current;
      if (getNativeSidebarChat()) {
        const selected = targetRef.current;
        const latest = chatRef.current;
        if (selected.kind === "native-agent") writeDraft(currentUser.id, selected.agent.draftKey ?? selected.agent.id, latest.editor?.getText() ?? "");
        if (aiSessionRef.current) latest.selectSession(aiSessionRef.current);
        const stored = drafts.current.get("ai");
        latest.editor?.commands.setContent(stored?.html ?? "", { emitUpdate: false });
        latest.resetFiles(stored?.files ?? []);
      }
      setNativeSidebarChat(null);
    };
  }, [sidebarEnabled, projectId, currentUser?.id]);

  useEffect(() => {
    if (target.kind !== "ai" && !agents.some((agent) => agent.id === target.agent.id)) void selectTargetRef.current({ kind: "ai" });
  }, [agents]);

  useEffect(() => { handledDeepLink.current = null; }, [projectId, currentUser?.id, sidebarEnabled]);
  useEffect(() => {
    if (!sidebarEnabled || !deepLink || handledDeepLink.current === deepLink) return;
    const agent = agents.find((item) => item.id === deepLink);
    if (!agent) return;
    handledDeepLink.current = deepLink;
    void selectTargetRef.current({ kind: agent.runtimeType === "EXTERNAL" ? "external-agent" : "native-agent", agent });
  }, [agents, deepLink, sidebarEnabled]);

  const embeddedAgents = useMemo(() => visited.map((agent): TAgent => ({
    id: agent.id, displayName: agent.displayName, photoURL: agent.photoURL, runtimeType: agent.runtimeType,
    visibility: "PRIVATE", createdAt: "", revokedAt: null, archivedAt: null,
    heartbeatAt: null, prompt: null, modelOptionId: null,
  })), [visited]);
  const isMbl = useContext(MobileViewContext);
  const [sidebarWidthPx] = useRecoilState(aiChatSidebarWidthPxAtom);

  const desktopWidthStyle =
    !inOffcanvas && !isMbl
      ? {
          width: Math.max(sidebarWidthPx, AI_CHAT_SIDEBAR_MIN_PX),
          flexShrink: 0 as const,
        }
      : undefined;

  const publishedWidthPx = desktopWidthStyle?.width ?? 0;
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ht-ai-sidebar-width", `${publishedWidthPx}px`);
    return () => {
      root.style.setProperty("--ht-ai-sidebar-width", "0px");
    };
  }, [publishedWidthPx]);

  return (
    <div
      data-ai-chat-panel
      ref={shortcuts.surfaceRef} data-ai-chat-surface={shortcuts.enabled ? "sidebar" : undefined}
      onKeyDownCapture={sharedShortcutsEnabled ? shortcuts.onKeyDownCapture : undefined}
      tabIndex={shortcuts.enabled ? -1 : undefined}
      data-testid="ai-sidebar"
      className={cn(
        "ai-chat-sidebar bg-ai-chat flex sticky top-0 min-h-0 min-w-0 text-white-black shadow-md",
        inOffcanvas
          ? "h-full min-h-0 w-full flex-col"
          : [
              "h-SVH-full z-[51] max-md:fixed max-md:inset-0 max-md:z-[9991] max-md:w-full",
              "flex-col md:flex-row md:shrink-0",
            ]
      )}
      style={desktopWidthStyle}
    >
      {shortcuts.modal}
      <AiChatSidebarResizeHandle />

      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col border-l-thin border-[#434343]"
        )}
      >
        <ChatHeader sidebarChats={enabled && sidebarEnabled ? { projectId: projectId!, target, agents, error: rosterError,
          onSelect: (next) => void selectTarget(next), onSelectSession: pastChatsFirst ? (id) => void selectTarget({ kind: "ai" }, id) : chat.selectSession, onRetry: () => void loadRoster(),
          ...(agentSessionsEnabled ? {
            onSelectAgentSession: (agent: SidebarChatAgent, sessionId: string) => void selectTarget({ kind: agent.runtimeType === "EXTERNAL" ? "external-agent" : "native-agent", agent }, undefined, { sessionId }),
            onLoadMoreAgentSessions: (agent: SidebarChatAgent) => void loadMoreAgentSessions(agent),
            onStartAgentSession: (agent: SidebarChatAgent) => void selectTarget({ kind: agent.runtimeType === "EXTERNAL" ? "external-agent" : "native-agent", agent }, undefined, { newSession: true }),
          } : {}) } : undefined} />

        {!minimized && (
          <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", sidebarEnabled && target.kind === "external-agent" && "hidden")}>
            <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
              {sidebarEnabled ? (
                <>
                  {(showWelcomeScreen || generalChatPending) && <WelcomeScreen />}
                  <MessageList sidebarKey={chat.currentSession?.id} hidden={showWelcomeScreen || generalChatPending}
                    active={target.kind !== "external-agent" && !showWelcomeScreen && !generalChatPending} />
                </>
              ) : showWelcomeScreen ? <WelcomeScreen /> : <MessageList />}
            </div>

            <AI_Tiptap_Container sidebarAgent={agentSessionsEnabled && target.kind === "native-agent" ? target.agent.displayName : undefined} disabled={generalChatPending} active={!sidebarEnabled || target.kind !== "external-agent"} />
          </div>
        )}
        {sidebarEnabled && !minimized && currentUser && embeddedAgents.map((agent, index) => (
          <div key={`${projectId}:${agent.id}:${visited[index].sessionId}`} className={cn("min-h-0 min-w-0 flex-1 flex-col", target.kind === "external-agent" && target.agent.id === agent.id && target.agent.sessionId === visited[index].sessionId ? "flex" : "hidden")}>
            <AgentChatClient currentUser={currentUser} roomsEnabled={false}
              embedded={{ projectId: projectId!, agent, requestId: intentRef.current, sessionId: agentSessionsEnabled ? visited[index].sessionId ?? undefined : undefined, draftKey: visited[index].draftKey, routedDraft: routedDraft?.sessionId === visited[index].sessionId ? routedDraft : undefined, onRoutedDraftConsumed: (requestId) => setRoutedDraft((previous) => previous?.requestId === requestId ? null : previous), active: target.kind === "external-agent" && target.agent.id === agent.id && target.agent.sessionId === visited[index].sessionId }} />
          </div>
        ))}
      </div>
    </div>
  );
};
