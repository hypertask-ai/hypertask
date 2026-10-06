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
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6278_CHAT_TURN_FAILURE_FLAG, HTPR_6924_REST_COMPAT_FLAG } from "@/lib/flags/keys";
import { useQueryClient } from "@tanstack/react-query";
import { aiOptionsWithoutOpenRouter } from "./aiChatShared";

export function useAiChatState() {

  const lastWorkspaceFocusRef = useRef<HTMLElement | null>(null);
  // HTPR-6278: surfacing real server refusals and silent stream ends instead
  // of the blanket "Connection lost" message.
  const restCompat = useFlag(HTPR_6924_REST_COMPAT_FLAG);
  const turnFailureState = useFlag(HTPR_6278_CHAT_TURN_FAILURE_FLAG);
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

  // Remember where keyboard work was happening outside the docked chat. This
  // lets Control+Q return to the exact board, inbox, or other workspace control
  // instead of merely focusing the workspace wrapper (HTPR-5204).
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
  // HTPR-5036: the chat had no idea which screen it was on, so on cross-board
  // surfaces (My Tasks, inbox, calendar) it saw an empty context and answered
  // "no active board or view" instead of using the user's own workload.
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
  // FIFO follow-ups typed while a turn is streaming (HTPR-5695).
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
  // Mirrors currentStreamingSession, but set synchronously at the moment a stream starts.
  // State only reaches the unmount/unload handlers after a commit, so a tab closed in the
  // instant between "fetch sent" and "React committed" would leave the stream running.
  const streamingSessionRef = useRef<string | null>(null);
  const streamingAssistantMessageRef = useRef<string | null>(null);
  const streamingRequestRef = useRef<string | null>(null);
  // Set synchronously before any send-path await. isTyping updates on the next
  // render, so it cannot by itself stop two callers that enter in one tick or a
  // deferred summarize racing a manual send.
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
  // A board the user picked in the scope selector, as opposed to the one the
  // page happens to be showing. Only the latter is dropped on all-board pages.
  const boardScopeIsExplicit = isFullScreenChat
    ? fullScreenChatScope != null
    : dockedChatScope !== null && dockedChatScope !== "all";
  // ponytail: the editor is no longer built here. ChatProvider wraps every
  // route, so calling useTiptapForAI() inline pulled the whole tiptap stack
  // (~250 KB) into the initial chunk of every page, closed chat or not. It now
  // lives in <AiChatEditorMount>, which ChatProvider loads dynamically once the
  // chat has been opened, and hands the instance back through setEditor
  // (HTPR-4508). Every `editor?.` call below already tolerated null: useEditor
  // runs with immediatelyRender:false, so editor was null on first render anyway.
  const [editor, setEditor] = useState<Editor | null>(null);
  // Seeded true on /chat so the dedicated chat page starts the chunk fetch on
  // its first render rather than an effect later, which showed an empty strip
  // where the composer belongs.
  const [editorEnabled, setEditorEnabled] = useState(isFullScreenChat);

  /**
   *Function for handling tiptap mentions
   *Mentions are then added to context w.r.t type
   * @param {*} mentionData
   */
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
  // contextCallback is a plain (re-created every render) function declaration;
  // route it through a ref so the mount's props stay stable and the editor is
  // never torn down and rebuilt, which would drop the user's draft.
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
  // Latches on: once the chat has been opened the editor stays mounted, so
  // closing and reopening keeps the draft rather than paying for a rebuild.
  // /chat is the dedicated full-screen chat, where the composer must be live on
  // arrival rather than waiting for the docked panel's open flag.
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
    sessions, historySessions, hasMoreSessions, isLoadingMoreSessions, pagingError, loadMoreSessions, resolveHistorySession,
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
    // Navigating to a different ticket must bump the generation too, so an
    // in-flight ensureSessionForCurrentBoard() poll for the old ticket can't
    // land a send into a conversation the user has since navigated away
    // from (HTPR-6100).
    taskId ?? "no-task",
    restCompat ? HTPR_6924_REST_COMPAT_FLAG : "legacy",
  ].join(":");
  const setupContextRef = useRef(sessionContextKey);
  if (setupContextRef.current !== sessionContextKey) {
    setupContextRef.current = sessionContextKey;
    sessionIntentGenerationRef.current += 1;
    sessionSetupRef.current = null;
    resolvedBoardSessionRef.current = null;
    previousProjectIdRef.current = undefined;
    // Drop queued follow-ups when board/scope/surface changes so they cannot
    // auto-send into a different session (HTPR-5695 review).
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
  lastWorkspaceFocusRef, turnFailureState, queryClient, currentUser, currentProject,
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
  currentSession, showWelcomeScreen, isSessionPending, sessions, historySessions, hasMoreSessions, isLoadingMoreSessions, pagingError, loadMoreSessions, resolveHistorySession, restCompat, selectSessionInHistory,
  chatHistoryReady, addMessageToSessionQuery, updateLastMessageInSessionCache, appendMessageToSessionCache, updateSessionTitle,
  deleteSessionInHistory, sessionsRef, chatHistoryReadyRef, sessionSetupRef, resolvedBoardSessionRef,
  sessionIntentGenerationRef, sessionContextKey, clearMessageQueue,
  };
}
