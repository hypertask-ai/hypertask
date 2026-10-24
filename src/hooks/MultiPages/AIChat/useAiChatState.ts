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
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7316_CHAT_SCOPE_TICKET_FLAG } from "@/lib/flags/keys";
import { aiOptionsWithoutOpenRouter } from "./aiChatShared";
import { createSessionMessageQueue, type QueuedAiChatMessage } from "@/lib/aiChat/sessionMessageQueue";
import { HTPR_7767_SESSION_MESSAGE_QUEUE_FLAG } from "@/lib/flags/definitions/htpr-7767-session-message-queue";

type AiChatInteractionState =
  | { kind: 'idle' }
  | { kind: 'recording' }
  | { kind: 'sending' }
  | { kind: 'streaming'; sessionId: string; assistantMessageId: string; requestId: string };

type AiChatStateAction =
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'START_SENDING' }
  | { type: 'START_STREAMING'; sessionId: string; assistantMessageId: string; requestId: string }
  | { type: 'CANCEL_STREAM' }
  | { type: 'COMPLETE_STREAM' };

function aiChatStateReducer(state: AiChatInteractionState, action: AiChatStateAction): AiChatInteractionState {
  switch (action.type) {
    case 'START_RECORDING':
      if (state.kind === 'idle') return { kind: 'recording' };
      return state;
    case 'STOP_RECORDING':
      if (state.kind === 'recording') return { kind: 'idle' };
      return state;
    case 'START_SENDING':
      if (state.kind === 'idle') return { kind: 'sending' };
      return state;
    case 'START_STREAMING':
      if (state.kind === 'sending' || state.kind === 'idle') {
        return {
          kind: 'streaming',
          sessionId: action.sessionId,
          assistantMessageId: action.assistantMessageId,
          requestId: action.requestId,
        };
      }
      return state;
    case 'CANCEL_STREAM':
    case 'COMPLETE_STREAM':
      if (state.kind === 'streaming') return { kind: 'idle' };
      return state;
    default:
      return state;
  }
}

export function useAiChatState() {

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
  const isDetailPage = pathname?.startsWith("/detail") ?? false;
  const isFullScreenChat = pathname?.startsWith("/chat") ?? false;
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
  const [interactionState, dispatch] = useState<AiChatInteractionState>({ kind: 'idle' });
  const [queuedMessages, setQueuedMessages] = useState<QueuedAiChatMessage[]>([]);
  const messageQueueRef = useRef<QueuedAiChatMessage[]>([]);
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
  const persistentQueue = persistentQueueEnabled ? sessionQueue : undefined;
  const [showScrollUpIndicator, setShowScrollUpIndicator] =
    useState<boolean>(false);
  const { currentAiOption, setAiOption, modelTeamId, modelBilling, usesPlanDefault, agentSessionAiOption } =
    useAiChatModelPreference();
  const streamingSessionRef = useRef<string | null>(null);
  const streamingAssistantMessageRef = useRef<string | null>(null);
  const streamingRequestRef = useRef<string | null>(null);
  const sendInFlightRef = useRef(false);
  
  const dispatchStateAction = useCallback((action: AiChatStateAction) => {
    dispatch((prevState) => aiChatStateReducer(prevState, action));
  }, []);
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
  const contextCallbackRef = useRef(contextCallback);
  contextCallbackRef.current = contextCallback;
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
  } = useSessionAndChatHistory(taskId, shouldLoadChatHistory, isDetailPage);
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
    taskId ?? "no-task",
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

  const isTyping = interactionState.kind === 'streaming';
  const isRecording = interactionState.kind === 'recording';
  const currentStreamingSession = interactionState.kind === 'streaming' ? interactionState.sessionId : null;

  const setIsTyping = useCallback((value: boolean) => {
    if (value) {
      dispatchStateAction({ type: 'START_STREAMING', sessionId: '', assistantMessageId: '', requestId: '' });
    } else {
      dispatchStateAction({ type: 'COMPLETE_STREAM' });
    }
  }, [dispatchStateAction]);

  const setIsRecording = useCallback((value: boolean) => {
    if (value) {
      dispatchStateAction({ type: 'START_RECORDING' });
    } else {
      dispatchStateAction({ type: 'STOP_RECORDING' });
    }
  }, [dispatchStateAction]);

  const setCurrentStreamingSession = useCallback((sessionId: string | null) => {
    if (sessionId) {
      dispatchStateAction({ type: 'START_STREAMING', sessionId, assistantMessageId: '', requestId: '' });
    } else {
      dispatchStateAction({ type: 'COMPLETE_STREAM' });
    }
  }, [dispatchStateAction]);

  useEffect(() => {
    streamingSessionRef.current = interactionState.kind === 'streaming' ? interactionState.sessionId : null;
    streamingAssistantMessageRef.current = interactionState.kind === 'streaming' ? interactionState.assistantMessageId : null;
    streamingRequestRef.current = interactionState.kind === 'streaming' ? interactionState.requestId : null;
    sendInFlightRef.current = interactionState.kind === 'sending';
  }, [interactionState]);

  const startSending = useCallback(() => {
    dispatchStateAction({ type: 'START_SENDING' });
  }, [dispatchStateAction]);

  const startStreaming = useCallback((sessionId: string, assistantMessageId: string, requestId: string) => {
    dispatchStateAction({ type: 'START_STREAMING', sessionId, assistantMessageId, requestId });
  }, [dispatchStateAction]);

  const completeStream = useCallback(() => {
    dispatchStateAction({ type: 'COMPLETE_STREAM' });
  }, [dispatchStateAction]);

  const cancelStream = useCallback(() => {
    dispatchStateAction({ type: 'CANCEL_STREAM' });
  }, [dispatchStateAction]);

  return {
  lastWorkspaceFocusRef, queryClient, currentUser, currentProject,
  showAiChatInterface, setShowAIChat, setAiChatAutoOpenSuppressed, setAiChatExplicitOpenAt, aiChatExplicitOpenAt,
  aiChatBoardSessionMap, setAiChatBoardSessionMap, setRecentChatBoardIds, setAiChatPinned, isSidebarMode,
  setIsSidebarMode, showMentionList, inViewObject, dockedChatScope, setDockedChatScope,
  pathname, isDetailPage, isFullScreenChat, surface, spansAllBoards,
  chatMounted, setChatMounted, minimized, setMinimized, isTyping,
  setIsTyping, queuedMessages: visibleQueuedMessages, persistentQueue, setQueuedMessages, messageQueueRef, showScrollUpIndicator,
  setShowScrollUpIndicator, currentAiOption, setAiOption, modelTeamId, modelBilling, usesPlanDefault, agentSessionAiOption,
  streamingSessionRef, streamingAssistantMessageRef, streamingRequestRef, sendInFlightRef, currentStreamingSession,
  setCurrentStreamingSession, isRecording, setIsRecording, displayAiOptions, contextList,
  setContextList, agentStatus, setAgentStatus, showRenameChatModal, setShowRenameChatModal,
  messageListRef, hasAttemptedRestoreRef, previousProjectIdRef, toggleCreateTaskGlobally, token,
  dockedProjectId, scopedProjectId, boardScopeIsExplicit, ticketScopeSelected, editor, editorEnabled,
  editorMountProps, taskId, shouldLoadChatHistory, createSession, activeSession,
  currentSession, showWelcomeScreen, isSessionPending, sessions, historySessions, hasMoreSessions, isLoadingMoreSessions, pagingError, loadMoreSessions, refreshHistorySessions, resolveHistorySession, getDisplayedSession, sessionPagingEnabled, selectSessionInHistory,
  chatHistoryReady, addMessageToSessionQuery, updateLastMessageInSessionCache, appendMessageToSessionCache, updateSessionTitle,
  deleteSessionInHistory, sessionsRef, chatHistoryReadyRef, sessionSetupRef, resolvedBoardSessionRef,
  sessionIntentGenerationRef, sessionContextKey, clearMessageQueue,
  startSending, startStreaming, completeStream, cancelStream,
  };
}
