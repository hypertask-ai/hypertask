import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { TAiModal } from "@/models/AI_Task_writer_model";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { useSessionAndChatHistory } from "@/hooks/MultiPages/AIChat/useSessionAndChatHistory";
import { currentProjectAtom, currentUserAtom, aiChatAutoOpenSuppressedAtom, aiChatBoardSessionMapAtom, aiChatExplicitOpenAtAtom, aiChatPinnedAtom, dockedChatScopeAtom, fullScreenChatScopeAtom, inViewObjectAtom, isAiChatSidebarModeAtom, recentChatBoardIdsAtom, showAIChatInterfaceAtom, showMentionListAtom } from "@/store";
import { MentionItem, IChatSession } from "@/models/model";
import { usePathname } from "next/navigation";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { useMcpToken } from "@/components/Modals/McpToken/hooks/useMcpToken";
import { FileItem } from "@/components/Common/AttachmentsUpload/FileUploadHandler";
import { useAiChatModelPreference } from "./useAiChatModelPreference";
import { useQueryClient } from "@tanstack/react-query";
import { aiOptionsWithoutOpenRouter } from "./aiChatShared";

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
  const [dockedChatScope, setDockedChatScope] = useRecoilState(
    dockedChatScopeAtom
  );
  const pathname = usePathname();
  const isDetailPage = pathname?.startsWith("/detail") ?? false;
  const isFullScreenChat = pathname?.startsWith("/chat") ?? false;

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
  const [isTyping, setIsTyping] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<
    { id: string; content: string; html: string; files: FileItem[] }[]
  >([]);
  const messageQueueRef = useRef<
    { id: string; content: string; html: string; files: FileItem[] }[]
  >([]);
  const [showScrollUpIndicator, setShowScrollUpIndicator] =
    useState<boolean>(false);
  const { currentAiOption, setAiOption, modelTeamId, modelBilling } =
    useAiChatModelPreference();
  const streamingSessionRef = useRef<string | null>(null);
  const streamingAssistantMessageRef = useRef<string | null>(null);
  const streamingRequestRef = useRef<string | null>(null);
  const sendInFlightRef = useRef(false);
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
    dockedChatScope === null
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
    : dockedChatScope !== null && dockedChatScope !== "all";
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
  return {
  lastWorkspaceFocusRef, queryClient, currentUser, currentProject,
  showAiChatInterface, setShowAIChat, setAiChatAutoOpenSuppressed, setAiChatExplicitOpenAt, aiChatExplicitOpenAt,
  aiChatBoardSessionMap, setAiChatBoardSessionMap, setRecentChatBoardIds, setAiChatPinned, isSidebarMode,
  setIsSidebarMode, showMentionList, inViewObject, dockedChatScope, setDockedChatScope,
  pathname, isDetailPage, isFullScreenChat, surface, spansAllBoards,
  chatMounted, setChatMounted, minimized, setMinimized, isTyping,
  setIsTyping, queuedMessages, setQueuedMessages, messageQueueRef, showScrollUpIndicator,
  setShowScrollUpIndicator, currentAiOption, setAiOption, modelTeamId, modelBilling,
  streamingSessionRef, streamingAssistantMessageRef, streamingRequestRef, sendInFlightRef, currentStreamingSession,
  setCurrentStreamingSession, isRecording, setIsRecording, displayAiOptions, contextList,
  setContextList, agentStatus, setAgentStatus, showRenameChatModal, setShowRenameChatModal,
  messageListRef, hasAttemptedRestoreRef, previousProjectIdRef, toggleCreateTaskGlobally, token,
  dockedProjectId, scopedProjectId, boardScopeIsExplicit, editor, editorEnabled,
  editorMountProps, taskId, shouldLoadChatHistory, createSession, activeSession,
  currentSession, showWelcomeScreen, isSessionPending, sessions, historySessions, hasMoreSessions, isLoadingMoreSessions, pagingError, loadMoreSessions, refreshHistorySessions, resolveHistorySession, getDisplayedSession, sessionPagingEnabled, selectSessionInHistory,
  chatHistoryReady, addMessageToSessionQuery, updateLastMessageInSessionCache, appendMessageToSessionCache, updateSessionTitle,
  deleteSessionInHistory, sessionsRef, chatHistoryReadyRef, sessionSetupRef, resolvedBoardSessionRef,
  sessionIntentGenerationRef, sessionContextKey, clearMessageQueue,
  };
}
