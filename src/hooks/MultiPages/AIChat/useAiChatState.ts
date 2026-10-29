import { createSessionStreams } from "@/lib/aiChat/sessionStreams";
import { useAiChatDraft } from "./useAiChatDraft";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { TAiModal } from "@/models/AI_Task_writer_model";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { useSessionAndChatHistory } from "@/hooks/MultiPages/AIChat/useSessionAndChatHistory";
import { useDockedChatScope } from "@/hooks/MultiPages/AIChat/useDockedChatScope";
import { currentProjectAtom, currentUserAtom, aiChatAutoOpenSuppressedAtom, aiChatBoardSessionMapAtom, aiChatExplicitOpenAtAtom, aiChatPinnedAtom, fullScreenChatScopeAtom, inViewObjectAtom, isAiChatSidebarModeAtom, recentChatBoardIdsAtom, showAIChatInterfaceAtom, showMentionListAtom } from "@/store";
import { MentionItem, IChatSession } from "@/models/model";
import { usePathname } from "next/navigation";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { useMcpToken } from "@/components/Modals/McpToken/hooks/useMcpToken";
import { useAiChatModelPreference } from "./useAiChatModelPreference";
import { useQueryClient } from "@tanstack/react-query";
import { HTPR_8048_AGENT_SESSIONS_FLAG } from "@/lib/flags/definitions/htpr-8048-agent-sessions";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7622_AI_SETTINGS_FLAG } from "@/lib/flags/definitions/htpr-7622-ai-settings";
import { HTPR_8088_MANUAL_CHAT_FLAG } from "@/lib/flags/definitions/htpr-8088-manual-chat";
import { HTPR_7316_CHAT_SCOPE_TICKET_FLAG, HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG } from "@/lib/flags/keys";
import { aiOptionsWithoutOpenRouter } from "./aiChatShared";
import { createSessionMessageQueue, type QueuedAiChatMessage } from "@/lib/aiChat/sessionMessageQueue";
import { HTPR_7767_SESSION_MESSAGE_QUEUE_FLAG } from "@/lib/flags/definitions/htpr-7767-session-message-queue";

export function useAiChatState(parallelChatsEnabled = false) {
  const agentSessionsEnabled = useFlag(HTPR_8048_AGENT_SESSIONS_FLAG);
  const agentSidebarEnabled = useFlag(HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG);

  const lastWorkspaceFocusRef = useRef<HTMLElement | null>(null);
  const queryClient = useQueryClient();
  const currentUser = useRecoilValue(currentUserAtom);
  const currentProject = useRecoilValue(currentProjectAtom);
  const [showAiChatInterface, setShowAIChat] = useRecoilState(
    showAIChatInterfaceAtom
  );
  const setAiChatAutoOpenSuppressed = useSetRecoilState(aiChatAutoOpenSuppressedAtom);
  const setAiChatExplicitOpenAt = useSetRecoilState(aiChatExplicitOpenAtAtom);
  const aiChatExplicitOpenAt = useRecoilValue(aiChatExplicitOpenAtAtom);
  const [aiChatBoardSessionMap, setAiChatBoardSessionMap] = useRecoilState(
    aiChatBoardSessionMapAtom
  );
  const setRecentChatBoardIds = useSetRecoilState<number[]>(
    recentChatBoardIdsAtom
  );
  const setAiChatPinned = useSetRecoilState(aiChatPinnedAtom);
  const [isSidebarMode, setIsSidebarMode] = useRecoilState(
    isAiChatSidebarModeAtom
  );
  const showMentionList = useRecoilValue(showMentionListAtom);
  const inViewObject = useRecoilValue(inViewObjectAtom);
  const fullScreenChatScope = useRecoilValue(fullScreenChatScopeAtom);
  const [dockedChatScope, setDockedChatScope] = useDockedChatScope();
  const pathname = usePathname();
  const settingsEnabled = useFlag(HTPR_7622_AI_SETTINGS_FLAG);
  const isSettingsPage = settingsEnabled && (pathname === "/settings" || pathname?.startsWith("/settings/"));
  const isDetailPage = pathname?.startsWith("/detail") ?? false;
  const isFullScreenChat = pathname?.startsWith("/chat") ?? false;
  const manualChat = useFlag(HTPR_8088_MANUAL_CHAT_FLAG);
  const manualDockedChat = manualChat && !isFullScreenChat && !(pathname?.startsWith("/demo") ?? false);
  const ticketScopeEnabled = useFlag(HTPR_7316_CHAT_SCOPE_TICKET_FLAG);
  const ticketScopeSelected =
    ticketScopeEnabled && !isFullScreenChat && isDetailPage &&
    !!inViewObject?.taskId && dockedChatScope === "ticket";

  useEffect(() => {
    if (dockedChatScope === "ticket" && !ticketScopeSelected) {
      setDockedChatScope(null);
    }
  }, [dockedChatScope, ticketScopeSelected, setDockedChatScope]);

  useEffect(() => {
    const rememberWorkspaceFocus = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("[data-ai-workspace]")
      ) {
        lastWorkspaceFocusRef.current = target;
      }
    };

    document.addEventListener("focusin", rememberWorkspaceFocus);
    return () => document.removeEventListener("focusin", rememberWorkspaceFocus);
  }, []);
  const surface = !pathname
    ? "unknown"
    : isSettingsPage ? "settings"
    : pathname.startsWith("/my-tasks")
      ? "my_tasks"
      : pathname.startsWith("/inbox")
        ? "inbox"
        : pathname.startsWith("/calendar")
          ? "calendar"
          : isDetailPage
            ? "task_detail"
            : isFullScreenChat
              ? "chat"
              : pathname.startsWith("/demo")
                ? "demo_board"
                : "board";
  const spansAllBoards =
    surface === "my_tasks" || surface === "inbox" || surface === "calendar";
  const [chatMounted, setChatMounted] = useState<boolean>(false);
  const [minimized, setMinimized] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<QueuedAiChatMessage[]>([]);
  const messageQueueRef = useRef<QueuedAiChatMessage[]>([]);
  const [, refreshStreams] = useState(0);
  const sessionStreams = useMemo(() => createSessionStreams(() => refreshStreams((version) => version + 1)), [currentUser?.id]);
  const parallelStreams = parallelChatsEnabled ? sessionStreams : undefined;
  const persistentQueueEnabled = useFlag(HTPR_7767_SESSION_MESSAGE_QUEUE_FLAG);
  const [, refreshQueue] = useState(0);
  const sessionQueue = useMemo(() => {
    let storage: Storage | null = null;
    try {
      if (typeof window !== "undefined") storage = window.sessionStorage;
    } catch {
    }
    return createSessionMessageQueue(currentUser?.id ?? 0, storage, () => refreshQueue((version) => version + 1));
  }, [currentUser?.id]);
  const persistentQueue = persistentQueueEnabled || parallelChatsEnabled ? sessionQueue : undefined;
  const [showScrollUpIndicator, setShowScrollUpIndicator] =
    useState<boolean>(false);
  const { currentAiOption, setAiOption, modelTeamId, modelBilling, usesPlanDefault, agentSessionAiOption } =
    useAiChatModelPreference();
  const streamingSessionRef = useRef<string | null>(null);
  const streamingAssistantMessageRef = useRef<string | null>(null);
  const streamingRequestRef = useRef<string | null>(null);
  const sendInFlightRef = useRef(false);
  const settleSendRef = useRef<(() => void) | null>(null);
  const [currentStreamingSession, setCurrentStreamingSession] = useState<
    string | null
  >(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [displayAiOptions] = useState<TAiModal[]>(aiOptionsWithoutOpenRouter);
  const [contextList, setContextList] = useState<MentionItem[]>([]);
  const [agentStatus, setAgentStatus] = useState<string | undefined>(undefined);
  const [showRenameChatModal, setShowRenameChatModal] =
    useState<boolean>(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const hasAttemptedRestoreRef = useRef(false);
  const previousProjectIdRef = useRef<number | undefined>(undefined);
  const { toggleCreateTaskGlobally } = useHypertasksRecoilStates();
  const { token } = useMcpToken();
  const dockedProjectId =
    dockedChatScope === null || dockedChatScope === "ticket"
      ? currentProject?.id
      : dockedChatScope === "all"
        ? undefined
        : dockedChatScope;
  const fullScreenProjectId = fullScreenChatScope ?? undefined;
  const scopedProjectId = isFullScreenChat
    ? fullScreenProjectId
    : dockedProjectId;
  const boardScopeIsExplicit = isFullScreenChat
    ? fullScreenChatScope != null
    : typeof dockedChatScope === "number";
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorEnabled, setEditorEnabled] = useState(isFullScreenChat);

  function contextCallback(mentionData: any) {
    if (mentionData.type === "task") {
      setContextList((prev) => {
        const exists = prev.some(
          (item: any) =>
            item.project_id === mentionData.project_id &&
            item.id === mentionData.id &&
            item.type === "task"
        );
        return exists ? prev : [...prev, mentionData];
      });
    } else if (mentionData.type === "project") {
      setContextList((prev) => {
        const exists = prev.some(
          (item: any) => item.id === mentionData.id && item.type === "project"
        );
        return exists ? prev : [...prev, mentionData];
      });
    } else if (mentionData.type === "agent") {
      setContextList((prev) => {
        const exists = prev.some(
          (item) => item.type === "agent" && item.id === mentionData.id
        );
        return exists ? prev : [...prev, mentionData];
      });
    } else if (mentionData.type === "name") {
    }
  }
  function agentContextCallback(mentionData: MentionItem) {
    if (mentionData.type === "agent" && currentProject?.id && currentUser && editor?.view.dom.closest('[data-testid="ai-sidebar"]')) {
      window.dispatchEvent(new CustomEvent("ht-sidebar-agent-selected", { detail: {
        agentId: mentionData.id, getDraft: () => ({ html: editor.getHTML(),
          text: editor.getText({ textSerializers: { mention: ({ node }) => `@${node.attrs.text || node.attrs.id}` } }),
        }),
      } }));
      return;
    }
    contextCallback(mentionData);
  }
  const contextCallbackRef = useRef(agentSessionsEnabled && agentSidebarEnabled ? agentContextCallback : contextCallback);
  contextCallbackRef.current = agentSessionsEnabled && agentSidebarEnabled ? agentContextCallback : contextCallback;
  const stableContextCallback = useCallback(
    (node: any) => contextCallbackRef.current(node),
    []
  );
  const editorMountProps = useMemo(
    () => ({
      contextCallback: stableContextCallback,
      projectId: scopedProjectId,
      onEditor: setEditor,
    }),
    [stableContextCallback, scopedProjectId]
  );
  useEffect(() => {
    if (showAiChatInterface || isFullScreenChat) setEditorEnabled(true);
  }, [showAiChatInterface, isFullScreenChat]);
  const taskId =
    isDetailPage && inViewObject?.taskId ? inViewObject.taskId : undefined;
  const shouldLoadChatHistory =
    isFullScreenChat || showAiChatInterface || chatMounted;
  let historyTaskId = taskId;
  if (manualChat) historyTaskId = undefined;

  const {
    startNewSession: createSession,
    activeSession,
    currentSession,
    showWelcomeScreen,
    isSessionPending,
    sessions, historySessions, hasMoreSessions, isLoadingMoreSessions, pagingError, loadMoreSessions, refreshHistorySessions, resolveHistorySession, getDisplayedSession, sessionPagingEnabled,
    selectSession: selectSessionInHistory,
    isSuccess: chatHistoryReady,
    addMessageToSessionQuery,
    updateLastMessageInSessionCache,
    appendMessageToSessionCache,
    updateSessionTitle,
    deleteSession: deleteSessionInHistory,
  } = useSessionAndChatHistory(historyTaskId, shouldLoadChatHistory, isDetailPage, manualDockedChat || parallelChatsEnabled, manualDockedChat, modelTeamId);
  useAiChatDraft({ editor, userId: currentUser?.id, sessionId: currentSession?.id, enabled: !currentSession?.agentId });
  sessionQueue.sessionId = currentSession?.id;
  useEffect(() => {
    sessionQueue.sessionId = currentSession?.id;
    return () => { sessionQueue.sessionId = undefined; };
  }, [sessionQueue, currentSession?.id]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const chatHistoryReadyRef = useRef(chatHistoryReady);
  chatHistoryReadyRef.current = chatHistoryReady;
  const sessionSetupRef = useRef<{
    key: string;
    promise: Promise<IChatSession | undefined>;
  } | null>(null);
  const resolvedBoardSessionRef = useRef<{
    projectId: number;
    session: IChatSession;
  } | null>(null);
  const sessionIntentGenerationRef = useRef(0);
  const sessionContextKey = [
    surface,
    isFullScreenChat ? "full-screen" : "docked",
    boardScopeIsExplicit ? "explicit" : "implicit",
    scopedProjectId ?? "all",
    currentProject?.id ?? "no-board",
    currentUser?.id ?? "anonymous",
    manualDockedChat ? "manual" : taskId ?? "no-task",
    ...(ticketScopeSelected ? ["ticket-scope"] : []),
    ...(sessionPagingEnabled ? ["htpr-6971-chat-history-paging"] : []),
  ].join(":");
  const setupContextRef = useRef(sessionContextKey);
  if (setupContextRef.current !== sessionContextKey) {
    setupContextRef.current = sessionContextKey;
    sessionIntentGenerationRef.current += 1;
    sessionSetupRef.current = null;
    resolvedBoardSessionRef.current = null;
    previousProjectIdRef.current = undefined;
    messageQueueRef.current = [];
  }

  const clearMessageQueue = useCallback(() => {
    messageQueueRef.current = [];
    setQueuedMessages([]);
  }, []);

  useEffect(() => {
    setQueuedMessages((prev) => (prev.length === 0 ? prev : []));
  }, [sessionContextKey]);
  let visibleQueuedMessages = queuedMessages;
  if (persistentQueue) {
    visibleQueuedMessages = currentSession ? persistentQueue.get(currentSession.id) : [];
  }
  const selectedStream = currentSession && parallelStreams?.get(currentSession.id);
  return {
  parallelStreams,
  lastWorkspaceFocusRef, queryClient, currentUser, currentProject,
  showAiChatInterface, setShowAIChat, setAiChatAutoOpenSuppressed, setAiChatExplicitOpenAt, aiChatExplicitOpenAt,
  aiChatBoardSessionMap, setAiChatBoardSessionMap, setRecentChatBoardIds, setAiChatPinned, isSidebarMode,
  setIsSidebarMode, showMentionList, inViewObject, dockedChatScope, setDockedChatScope,
  pathname, isDetailPage, isFullScreenChat, surface, spansAllBoards,
  chatMounted, setChatMounted, minimized, setMinimized, isTyping,
  setIsTyping, queuedMessages: visibleQueuedMessages, persistentQueue, setQueuedMessages, messageQueueRef, showScrollUpIndicator,
  setShowScrollUpIndicator, currentAiOption, setAiOption, modelTeamId, modelBilling, usesPlanDefault, agentSessionAiOption,
  streamingSessionRef, streamingAssistantMessageRef, streamingRequestRef, sendInFlightRef, settleSendRef, currentStreamingSession,
  setCurrentStreamingSession, isRecording, setIsRecording, displayAiOptions, contextList,
  setContextList, agentStatus, setAgentStatus, showRenameChatModal, setShowRenameChatModal,
  messageListRef, hasAttemptedRestoreRef, previousProjectIdRef, toggleCreateTaskGlobally, token,
  dockedProjectId, scopedProjectId, boardScopeIsExplicit, ticketScopeSelected, editor, editorEnabled,
  editorMountProps, taskId, manualChat, shouldLoadChatHistory, createSession, activeSession,
  currentSession, showWelcomeScreen, isSessionPending, sessions, historySessions, hasMoreSessions, isLoadingMoreSessions, pagingError, loadMoreSessions, refreshHistorySessions, resolveHistorySession, getDisplayedSession, sessionPagingEnabled, selectSessionInHistory,
  chatHistoryReady, addMessageToSessionQuery, updateLastMessageInSessionCache, appendMessageToSessionCache, updateSessionTitle,
  deleteSessionInHistory, sessionsRef, chatHistoryReadyRef, sessionSetupRef, resolvedBoardSessionRef,
  sessionIntentGenerationRef, sessionContextKey, clearMessageQueue,
  ...(selectedStream ? {
    isTyping: selectedStream.isTyping, setIsTyping: selectedStream.setIsTyping,
    agentStatus: selectedStream.agentStatus, setAgentStatus: selectedStream.setAgentStatus,
    sendInFlightRef: selectedStream.sendInFlightRef, settleSendRef: selectedStream.settleSendRef,
    streamingSessionRef: selectedStream.streamingSessionRef,
    streamingAssistantMessageRef: selectedStream.streamingAssistantMessageRef,
    streamingRequestRef: selectedStream.streamingRequestRef,
    currentStreamingSession: selectedStream.streamingSessionRef.current,
    setCurrentStreamingSession: selectedStream.setCurrentStreamingSession,
  } : {}),
  };
}
