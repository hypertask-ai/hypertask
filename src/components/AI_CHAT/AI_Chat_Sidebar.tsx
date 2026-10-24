"use client";

import { useFlag } from "@/hooks/useFlag";
import { HTPR_7688_PAST_CHATS_FIRST_FLAG } from "@/lib/flags/definitions/htpr-7688-past-chats-first";
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
  const chat = useAiChatContext();
  const { showWelcomeScreen, minimized } = chat;
  const enabled = useFlag(HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG);
  const pastChatsFirst = useFlag(HTPR_7688_PAST_CHATS_FIRST_FLAG);
  const project = useRecoilValue(currentProjectAtom);
  const currentUser = useRecoilValue(currentUserAtom);
  const projectId = project?.id;
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [target, setTarget] = useState<SidebarChatTarget>({ kind: "ai" });
  const [agents, setAgents] = useState<SidebarChatAgent[]>([]);
  const [visited, setVisited] = useState<SidebarChatAgent[]>([]);
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
      setAgents(data.agents);
      setRosterError(null);
    } catch (error) {
      if (generation !== rosterGeneration.current) return;
      setAgents([]);
      setRosterError(error instanceof Error ? error.message : "Could not load agents");
    }
  }, [enabled, projectId]);

  const selectTarget = async (next: SidebarChatTarget, aiSessionId?: string) => {
    const intent = ++intentRef.current;
    if (next.kind !== "ai" && !sidebarEnabled) return;
    let nativeSessionId: string | null = null;
    if (next.kind === "native-agent") {
      try {
        const response = await fetch("/api/agent-sidebar-chats", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, agentId: next.agent.id }) });
        const data = await response.json();
        if (!response.ok || !data.success || !data.session?.id) throw new Error(data.error ?? "Could not open chat");
        if (intent !== intentRef.current) return;
        if (target.kind !== "native-agent" && !chat.currentSession?.agentId) aiSessionRef.current = chat.currentSession?.id ?? null;
        await AI_Chat_API.getSessionTranscript(data.session.id, undefined, projectId);
        await queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
        if (intent !== intentRef.current) return;
        nativeSessionId = data.session.id;
      } catch (error) {
        if (intent !== intentRef.current) return;
        setRosterError(error instanceof Error ? error.message : "Could not open chat");
        return;
      }
    } else if (target.kind === "native-agent" && !aiSessionRef.current && !aiSessionId) {
      setNativeSidebarChat(null);
      await chat.startNewSession();
    }
    if (intent !== intentRef.current) return;
    const latest = chatRef.current;
    const leaving = targetRef.current;
    if (leaving.kind !== "external-agent") {
      const key = leaving.kind === "native-agent" ? leaving.agent.id : "ai";
      drafts.current.set(key, { html: latest.editor?.getHTML() ?? "", files: [...latest.fileItems] });
      if (leaving.kind === "native-agent") writeDraft(currentUser.id, leaving.agent.id, latest.editor?.getText() ?? "");
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
    if (next.kind === "external-agent") {
      if (leaving.kind === "native-agent") {
        const stored = drafts.current.get("ai");
        latest.editor?.commands.setContent(stored?.html ?? "", { emitUpdate: false });
        latest.resetFiles(stored?.files ?? []);
      }
      setVisited((previous) => previous.some((agent) => agent.id === next.agent.id) ? previous : [...previous, next.agent]);
    } else {
      const stored = drafts.current.get(next.kind === "native-agent" ? next.agent.id : "ai") ??
        (next.kind === "native-agent" ? { html: readDraft(currentUser.id, next.agent.id), files: [] } : undefined);
      latest.editor?.commands.setContent(stored?.html ?? "", { emitUpdate: false });
      latest.resetFiles(stored?.files ?? []);
    }
  };
  const selectTargetRef = useRef(selectTarget);
  selectTargetRef.current = selectTarget;

  useEffect(() => {
    const resumeTicketChat = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId: string }>).detail.sessionId;
      ++intentRef.current;
      setNativeSidebarChat(null);
      aiSessionRef.current = sessionId;
      setTarget({ kind: "ai" });
    };
    window.addEventListener("ht-ticket-chat-resume", resumeTicketChat);
    return () => window.removeEventListener("ht-ticket-chat-resume", resumeTicketChat);
  }, []);

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
    setAgents([]);
    aiSessionRef.current = null;
    drafts.current.clear();
    return () => {
      ++intentRef.current;
      if (getNativeSidebarChat()) {
        const selected = targetRef.current;
        const latest = chatRef.current;
        if (selected.kind === "native-agent") writeDraft(currentUser.id, selected.agent.id, latest.editor?.getText() ?? "");
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

  const deepLink = searchParams?.get("sidebarAgent");
  const handledDeepLink = useRef<string | null>(null);
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
      {!inOffcanvas && !isMbl && <AiChatSidebarResizeHandle />}

      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col border-l-thin border-[#434343]"
        )}
      >
        <ChatHeader sidebarChats={enabled && sidebarEnabled ? { projectId: projectId!, target, agents, error: rosterError,
          onSelect: (next) => void selectTarget(next), onSelectSession: pastChatsFirst ? (id) => void selectTarget({ kind: "ai" }, id) : chat.selectSession, onRetry: () => void loadRoster() } : undefined} />

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

            <AI_Tiptap_Container disabled={generalChatPending} active={!sidebarEnabled || target.kind !== "external-agent"} />
          </div>
        )}
        {sidebarEnabled && !minimized && currentUser && embeddedAgents.map((agent) => (
          <div key={`${projectId}:${agent.id}`} className={cn("min-h-0 min-w-0 flex-1 flex-col", target.kind === "external-agent" && target.agent.id === agent.id ? "flex" : "hidden")}>
            <AgentChatClient currentUser={currentUser} roomsEnabled={false}
              embedded={{ projectId: projectId!, agent, requestId: intentRef.current, active: target.kind === "external-agent" && target.agent.id === agent.id }} />
          </div>
        ))}
      </div>
    </div>
  );
};
