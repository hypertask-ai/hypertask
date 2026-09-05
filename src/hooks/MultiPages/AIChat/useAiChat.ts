import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Type-only: a value import would pull tiptap back into every page's initial
// chunk and undo the dynamic mount below (HTPR-4508).
import type { Editor } from "@tiptap/react";
import globalConstants from "@/lib/constants";
import { aiOptions } from "@/lib/constants/constants";
import { TAiModal } from "@/models/AI_Task_writer_model";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { SLASH_MENU_DOM_ID } from "@/lib/skills/slashSkills";
import { useSessionAndChatHistory } from "@/hooks/MultiPages/AIChat/useSessionAndChatHistory";
import {
  currentProjectAtom,
  currentUserAtom,
  aiChatAutoOpenSuppressedAtom,
  aiChatBoardSessionMapAtom,
  aiChatPinnedAtom,
  dockedChatScopeAtom,
  fullScreenChatScopeAtom,
  inViewObjectAtom,
  isAiChatSidebarModeAtom,
  recentChatBoardIdsAtom,
  showAIChatInterfaceAtom,
  showMentionListAtom,
} from "@/store";
import {
  MentionItem,
  ProjectMentionItem,
  TaskMentionItem,
  IChatMessage,
  IChatSession,
  IAttachment,
} from "@/models/model";
import { DIV_ID_CONSTANTS } from "@/lib/configs/general.config";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { usePathname } from "next/navigation";
import toast from "react-hot-toast";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { useMcpToken } from "@/components/Modals/McpToken/hooks/useMcpToken";
import {
  FileItem,
  useFileUpload,
} from "@/components/Common/AttachmentsUpload/FileUploadHandler";
import {
  convertFileToBase64,
  getFileTypeFromBase64,
} from "@/utils/helperFunctions/helperFunctions";
import {
  getFileTypeFromUrl,
  IMAGE_FALLBACK_MIME,
} from "@/utils/helperFunctions/getFileTypeFromUrl";
import { useCurrentBoardBilling } from "@/hooks/General/useCurrentBoardBilling";
import { shouldBlockAiDueToByokProvider } from "@/lib/byokSelectedProviderGate";
import { useAiModelPreference } from "@/hooks/General/useAiModelPreference";
import { isGuestCookieUser } from "@/lib/demo/isGuestClient";
import {
  generateGuestBoard,
  isGuestBoardBuild,
} from "@/lib/demo/guestBoardBuild";
import {
  readChatOpenForSession,
  writeChatOpenForSession,
} from "@/lib/aiChat/chatOpenSession";
import { useQueryClient } from "@tanstack/react-query";
import { refreshTaskComments } from "@/lib/realtime/taskCommentsRefresh";

const aiOptionsWithoutOpenRouter = aiOptions.filter(
  (option) => option.source !== "openrouter"
);

// Mirrors MobileViewProvider's own <768px threshold (src/lib/contexts/mobileContext.tsx).
const MOBILE_VIEWPORT_MAX_PX = 768;

/** User-facing text from streaming error payloads (may embed JSON or quoted API error bodies). */
function parseAiStreamErrorContent(raw: string): string {
  if (!raw?.trim()) {
    return "Sorry, an error occurred while processing your request.";
  }
  const messageDouble = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (messageDouble?.[1]) {
    return messageDouble[1].replace(/\\"/g, '"');
  }
  const messageSingle = raw.match(/'message':\s*'((?:[^'\\]|\\.)*)'/);
  if (messageSingle?.[1]) {
    return messageSingle[1];
  }
  if (
    raw.includes("context_length_exceeded") ||
    /exceed.*limit.*token/i.test(raw)
  ) {
    return "The conversation or attachments are too large for the model token limit. Try shortening your message or removing some context.";
  }
  if (raw.length > 800) {
    return `${raw.slice(0, 797)}…`;
  }
  return raw;
}

/** Inline images from the AI chat editor plus user-picked files from `fileItems`, ready for the chat API. */
export type AiChatProcessedAttachment = {
  fileName: string;
  url: string;
  mimeType: string | null;
};

export function useAiChat() {
  const lastWorkspaceFocusRef = useRef<HTMLElement | null>(null);
  const queryClient = useQueryClient();
  const currentUser = useRecoilValue(currentUserAtom);
  const currentProject = useRecoilValue(currentProjectAtom);
  const [showAiChatInterface, setShowAIChat] = useRecoilState(
    showAIChatInterfaceAtom
  );
  const setAiChatAutoOpenSuppressed = useSetRecoilState(aiChatAutoOpenSuppressedAtom);
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
  const { currentAiOption, setAiOption } = useAiModelPreference("aiChat");
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
    sessions,
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
  // User intent wins over transient automatic board setup. Clearing this ref
  // here means an explicit session click cannot be routed back to the session
  // that happened to be selected while React Query was propagating.
  const selectSession = useCallback((sessionId: string) => {
    sessionIntentGenerationRef.current += 1;
    sessionSetupRef.current = null;
    resolvedBoardSessionRef.current = null;
    clearMessageQueue();
    selectSessionInHistory(sessionId);
  }, [clearMessageQueue, selectSessionInHistory]);
  const startNewSession = useCallback(async () => {
    const generation = sessionIntentGenerationRef.current + 1;
    sessionIntentGenerationRef.current = generation;
    sessionSetupRef.current = null;
    resolvedBoardSessionRef.current = null;
    clearMessageQueue();
    const createdSession = await createSession(
      () => sessionIntentGenerationRef.current === generation
    );
    if (sessionIntentGenerationRef.current !== generation) return;
    // Reset an explicit docked scope only after the new session has committed.
    // Doing it before the request resolves changes the context generation and
    // makes this deliberate action invalidate its own result.
    if (!isFullScreenChat) setDockedChatScope(null);
    const projectId = currentProject?.id;
    if (createdSession && typeof projectId === "number") {
      resolvedBoardSessionRef.current = { projectId, session: createdSession };
      previousProjectIdRef.current = projectId;
    }
  }, [
    clearMessageQueue,
    createSession,
    currentProject?.id,
    isFullScreenChat,
    setDockedChatScope,
  ]);

  const deleteSession = useCallback(async (sessionId: string) => {
    sessionIntentGenerationRef.current += 1;
    sessionSetupRef.current = null;
    if (resolvedBoardSessionRef.current?.session.id === sessionId) {
      resolvedBoardSessionRef.current = null;
    }
    await deleteSessionInHistory(sessionId);
  }, [deleteSessionInHistory]);

  const fileUpload = useFileUpload();
  const fileUploadRef = useRef(fileUpload);
  fileUploadRef.current = fileUpload;
  const handleSendMessageRef = useRef<
    (
      retryContent?: string,
      options?: { htmlForAttachments?: string }
    ) => Promise<void>
  >(async () => {});

  const removeQueuedMessage = useCallback((id: string) => {
    messageQueueRef.current = messageQueueRef.current.filter(
      (item) => item.id !== id
    );
    setQueuedMessages(messageQueueRef.current);
  }, []);

  const drainQueuedMessage = useCallback(() => {
    if (sendInFlightRef.current) return;
    const queue = messageQueueRef.current;
    if (queue.length === 0) return;
    const [next, ...rest] = queue;
    messageQueueRef.current = rest;
    setQueuedMessages(rest);
    if (next.files.length > 0) {
      fileUploadRef.current.resetFiles(next.files);
    } else {
      fileUploadRef.current.clearFiles();
    }
    void handleSendMessageRef.current(next.content, {
      htmlForAttachments: next.html,
    });
  }, []);
  const billing = useCurrentBoardBilling();
  const isApple = useDeviceContext();
  const isByokBlocked = shouldBlockAiDueToByokProvider(billing, currentAiOption?.source);
  // HTPR-4303: guests live on the real board, not /demo, so the cheap-key
  // routing keys off the guest cookie identity as the source of truth.
  const isDemo = (pathname?.startsWith("/demo") ?? false) || isGuestCookieUser();
  // ponytail: demo chat is anonymous and must only reach the dedicated-key
  // route. The same value also derives both existing cancellation URLs.
  const chatRoute = isDemo
    ? "/api/demo/chat/stream"
    : globalConstants.sendAiChatMessageRoute;

  // Resolve the exact session for the current board in one shared operation.
  // This is called both by the open-chat effect and by every send, so a shortcut
  // that opens and sends in the same event cannot beat a later setup effect and
  // accidentally write into the previous board's cached session.
  const ensureSessionForCurrentBoard = useCallback(async (timeoutMs = 5000) => {
    const projectId = currentProject?.id;
    const userId = currentUser?.id;

    // A task-scoped surface (the ticket detail page) already owns session
    // selection via useSessionAndChatHistory's per-task init effect, which
    // finds-or-creates that exact ticket's session. Falling through to the
    // project-wide board session map below would let a session another
    // ticket in the same project last sent from win here too (HTPR-6100).
    if (taskId !== undefined) {
      // No signed-in user yet means no session can ever match; don't spin
      // for the full timeout waiting on a predicate that can't succeed.
      if (userId === undefined) return undefined;
      const matchesTask = (session: IChatSession) =>
        session.taskId === taskId && session.userId === userId;
      const deadline = Date.now() + timeoutMs;
      while (
        !sessionsRef.current.some(matchesTask) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return sessionsRef.current.find(matchesTask);
    }

    const needsBoardSession =
      typeof projectId === "number" &&
      !isFullScreenChat &&
      dockedChatScope === null &&
      !pathname?.startsWith("/inbox");
    const setupKey = `${sessionContextKey}:${
      needsBoardSession ? `board:${projectId}` : "current"
    }`;
    const inFlight = sessionSetupRef.current;
    if (inFlight?.key === setupKey) return inFlight.promise;
    const generation = sessionIntentGenerationRef.current;
    const isCurrentIntent = () =>
      sessionIntentGenerationRef.current === generation;

    const promise = (async () => {
      const deadline = Date.now() + timeoutMs;
      while (
        !sessionsRef.current.some((session) => session.userId === userId) &&
        !chatHistoryReadyRef.current &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!isCurrentIntent()) return undefined;

      // React Query changes cache keys with the account, but a render can still
      // momentarily expose the previous array. Never resolve a send through a
      // session owned by another authenticated user.
      const currentSessions = sessionsRef.current.filter(
        (session) => session.userId === userId
      );
      if (!currentSessions[0]) {
        if (!chatHistoryReadyRef.current) return undefined;
        const createdSession = await createSession(isCurrentIntent);
        if (!isCurrentIntent()) return undefined;
        if (createdSession && needsBoardSession && typeof projectId === "number") {
          resolvedBoardSessionRef.current = { projectId, session: createdSession };
          previousProjectIdRef.current = projectId;
        }
        return createdSession;
      }
      if (!needsBoardSession || typeof projectId !== "number") {
        return currentSessions[0];
      }
      if (!isCurrentIntent()) return undefined;

      // This board has already been initialized during the current visit. The
      // user may have deliberately selected another session since then, so the
      // currently selected/front session is the correct one.
      if (previousProjectIdRef.current === projectId) {
        const resolved = resolvedBoardSessionRef.current;
        if (resolved?.projectId === projectId) {
          if (currentSessions[0].id === resolved.session.id) {
            resolvedBoardSessionRef.current = null;
            return currentSessions[0];
          }
          return resolved.session;
        }
        return currentSessions[0];
      }

      const mappedSessionId = aiChatBoardSessionMap[projectId];
      if (mappedSessionId) {
        const mappedSession = currentSessions.find(
          (session) => session.id === mappedSessionId
        );
        if (mappedSession) {
          if (mappedSession.id !== currentSessions[0].id) {
            resolvedBoardSessionRef.current = {
              projectId,
              session: mappedSession,
            };
            selectSessionInHistory(mappedSession.id);
          }
          previousProjectIdRef.current = projectId;
          return mappedSession;
        }

        setAiChatBoardSessionMap((previousMap) => {
          const nextMap = { ...previousMap };
          delete nextMap[projectId];
          return nextMap;
        });
      }

      if ((currentSessions[0].messages?.length ?? 0) === 0) {
        previousProjectIdRef.current = projectId;
        return currentSessions[0];
      }

      const emptySession = currentSessions.find(
        (session) => (session.messages?.length ?? 0) === 0
      );
      if (emptySession) {
        resolvedBoardSessionRef.current = { projectId, session: emptySession };
        selectSessionInHistory(emptySession.id);
        previousProjectIdRef.current = projectId;
        return emptySession;
      }

      // Reuse empty sessions above to avoid creating one on every board visit.
      const createdSession = await createSession(isCurrentIntent);
      if (!isCurrentIntent()) return undefined;
      if (createdSession) {
        resolvedBoardSessionRef.current = { projectId, session: createdSession };
        previousProjectIdRef.current = projectId;
      }
      return createdSession;
    })();

    sessionSetupRef.current = { key: setupKey, promise };
    void promise.finally(() => {
      if (sessionSetupRef.current?.promise === promise) {
        sessionSetupRef.current = null;
      }
    });
    return promise;
  }, [
    aiChatBoardSessionMap,
    createSession,
    currentProject?.id,
    currentUser?.id,
    dockedChatScope,
    isFullScreenChat,
    pathname,
    sessionContextKey,
    selectSessionInHistory,
    setAiChatBoardSessionMap,
    taskId,
  ]);

  useEffect(() => {
    const projectId = currentProject?.id;
    if (typeof projectId !== "number") return;

    setRecentChatBoardIds((previousIds) => {
      if (previousIds[0] === projectId) return previousIds;

      return [
        projectId,
        ...previousIds.filter((id) => id !== projectId),
      ].slice(0, 12);
    });
  }, [currentProject?.id, setRecentChatBoardIds]);

  useEffect(() => {
    if (shouldLoadChatHistory) void ensureSessionForCurrentBoard();
  }, [ensureSessionForCurrentBoard, shouldLoadChatHistory]);

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

  const toggleSidebarMode = () => {
    setIsSidebarMode((prev) => !prev);
  };

  const togglePopover = () => {
    editor?.commands.blur();
    setAiChatAutoOpenSuppressed(true);
    setAiChatPinned(false);
    setShowAIChat(false);
    setMinimized(false);
    setChatMounted(false);
  };

  // Collapse the floating window to a bottom tab (chat stays mounted) and
  // reopen it, distinct from togglePopover which closes the chat entirely.
  const minimizeChat = () => {
    editor?.commands.blur();
    setMinimized(true);
  };
  const restoreChat = () => setMinimized(false);

  // If message is provided, use it; otherwise, find latest human message
  function retryStream(message?: IChatMessage) {
    const targetMsg =
      message ??
      [...(currentSession?.messages ?? [])].reverse().find((msg) => msg.role === "human");
    if (!targetMsg?.content) return;
    handleSendMessage(targetMsg.content);
  }

  // Load a sent message back into the composer so the user can rephrase and
  // resend it. Ambiguous phrasing is the main way the agent misreads a request,
  // and retry alone can only repeat the same words. (HTPR-4218)
  function editMessage(message: IChatMessage) {
    if (!message.content) return;
    editor?.commands.setContent(message.content);
    editor?.commands.focus("end");
  }

  function tiptapKeydown(e: any) {
    const cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);
    if (e.keyCode === KeyCodes.ENTER && !e.shiftKey) {
      // Don't process message if mention list is visible - let mention list handle Enter
      // Check both the state and DOM element as fallback
      const mentionListElement = document.getElementById(
        DIV_ID_CONSTANTS.aiMentionList
      );
      if (showMentionList || editor?.isEmpty) {
        return; // Let the mention list handle the Enter key
      }
      // The "/" skills menu (SlashCommands) is open: let its Enter handler pick
      // the skill instead of sending. The popup's DOM marker is the reliable
      // signal — NOT e.defaultPrevented, because ProseMirror always
      // preventDefaults Enter (its newline handling) before this bubbled handler
      // runs, so a defaultPrevented check would block every send.
      if (document.getElementById(SLASH_MENU_DOM_ID)) {
        return;
      }
      e.preventDefault();
      if (isByokBlocked) return;
      // While streaming, Enter queues (HTPR-5695) instead of being ignored.
      handleSendMessage();
    }
    if (e.keyCode === KeyCodes.ESCAPE && isTyping) {
      e.preventDefault();
      handleCancelStream();
    }
    if (
      e.keyCode === KeyCodes.Q &&
      e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey &&
      !e.repeat
    ) {
      e.preventDefault();
      if (
        !isFullScreenChat &&
        showAiChatInterface &&
        isSidebarMode &&
        window.innerWidth >= MOBILE_VIEWPORT_MAX_PX
      ) {
        const workspace = document.querySelector<HTMLElement>(
          "[data-ai-workspace]"
        );
        const previousWorkspaceTarget = lastWorkspaceFocusRef.current;
        if (
          previousWorkspaceTarget?.isConnected &&
          workspace?.contains(previousWorkspaceTarget)
        ) {
          previousWorkspaceTarget.focus({ preventScroll: true });
        } else {
          workspace?.focus({ preventScroll: true });
        }
        // React delegates this handler below document. Stop this same keydown
        // from reaching the global handler after focus has moved, or it would
        // immediately interpret the workspace as the source and bounce back.
        e.stopPropagation();
        return;
      }
      editor?.commands.focus("end");
    }
    if (e.keyCode === KeyCodes.U && cmdControl) {
      e.preventDefault();
      fileUpload.handleAttachmentClick();
    }
    // [cmd/ctrl]+[shift]+[d] → speech to text. The shortcut is advertised in the
    // cheatsheet and works in the comment composer, but nothing bound it here, so
    // in chat Chrome just took it (bookmark-all-tabs). Click the mic's anchor by
    // id, the same way the comment composer does, rather than lifting the
    // recorder's internals into this hook (HTPR-5086).
    if (e.keyCode === KeyCodes.D && cmdControl && e.shiftKey) {
      const anchor = document.getElementById("ai-chat-audio-button");
      if (anchor) {
        e.preventDefault();
        anchor.click();
      }
    }
  }

  function layoutKeydown(e: any) {
    var cmdControl = (isApple && e.metaKey) || (!isApple && e.ctrlKey);

    //Open AI Chat Interface
    if (e.keyCode === KeyCodes.FORWARD_SLASH && cmdControl && e.shiftKey) {
      e.preventDefault();
      if (!chatMounted) return setChatMounted(true);
      setTimeout(() => {
        togglePopover();
      }, 10);
    }

    if (
      e.keyCode === KeyCodes.Q &&
      e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey &&
      !e.repeat
    ) {
      e.preventDefault();

      // In the desktop sidebar layout, Control+Q is a two-way focus switch. It
      // keeps the chat visible and restores the precise workspace target when
      // possible. Full-screen/mobile chat retain the existing focus behavior.
      if (
        !isFullScreenChat &&
        showAiChatInterface &&
        isSidebarMode &&
        window.innerWidth >= MOBILE_VIEWPORT_MAX_PX
      ) {
        const activeElement = document.activeElement;
        const chatPanel = document.querySelector<HTMLElement>(
          "[data-ai-chat-panel]"
        );
        const workspace = document.querySelector<HTMLElement>(
          "[data-ai-workspace]"
        );

        if (
          activeElement instanceof HTMLElement &&
          chatPanel?.contains(activeElement)
        ) {
          const previousWorkspaceTarget = lastWorkspaceFocusRef.current;
          if (
            previousWorkspaceTarget?.isConnected &&
            workspace?.contains(previousWorkspaceTarget)
          ) {
            previousWorkspaceTarget.focus({ preventScroll: true });
          } else {
            workspace?.focus({ preventScroll: true });
          }
          return;
        }

        if (
          activeElement instanceof HTMLElement &&
          workspace?.contains(activeElement)
        ) {
          lastWorkspaceFocusRef.current = activeElement;
        }
        editor?.commands.focus("end");
        return;
      }

      if (!isFullScreenChat && !showAiChatInterface) {
        if (!chatMounted) setChatMounted(true);
        setShowAIChat(true);
        setAiChatAutoOpenSuppressed(false);
        setTimeout(() => {
          editor?.commands.focus("end");
        }, 10);
        return;
      }
      editor?.commands.focus("end");
      return;
    }

    //Start new Session shortcut handling
    if (
      (e.keyCode === KeyCodes.O || e.keyCode === KeyCodes.J) &&
      e.shiftKey &&
      cmdControl
    ) {
      e.preventDefault();
      if (showAiChatInterface) {
        startNewSession();
        // Land the cursor in the fresh composer. Plain DOM focus on the
        // mounted contenteditable — the Tiptap command path can silently
        // no-op here (HTPR-4565).
        setTimeout(() => { try { editor?.view.dom.focus(); } catch { /* view unmounted */ } }, 0);
        return;
      }
    }
  }

  const handleCancelStream = async () => {
    // The ref, not the state: a stream started microseconds ago has already set the ref
    // but may not have committed the state yet, and that stream is exactly the one an
    // unmount needs to cancel.
    const sessionId = streamingSessionRef.current ?? currentStreamingSession;
    if (!sessionId) return;
    const assistantMessageId = streamingAssistantMessageRef.current;
    const streamId = streamingRequestRef.current;
    if (!assistantMessageId || !streamId) {
      toast.error("Couldn’t identify the active reply. Try Stop again.");
      return;
    }
    const clearStreamingState = () => {
      if (
        streamingSessionRef.current !== sessionId ||
        streamingAssistantMessageRef.current !== assistantMessageId ||
        streamingRequestRef.current !== streamId
      ) {
        return;
      }
      streamingSessionRef.current = null;
      streamingAssistantMessageRef.current = null;
      streamingRequestRef.current = null;
      setCurrentStreamingSession(null);
      setIsTyping(false);
      setAgentStatus(undefined);
    };

    try {
      const response = await fetch(
        `${chatRoute.replace(
          "/stream",
          "/cancel"
        )}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            session_id: sessionId,
            assistant_message_id: assistantMessageId,
            stream_id: streamId,
          }),
        }
      );

      const result = await response.json();
      if (response.status === 409 && result?.status === "completed") {
        clearStreamingState();
        return;
      }
      if (!response.ok || result?.success !== true) {
        throw new Error(result?.error || "The active reply could not be stopped");
      }
      console.log("🔥 Cancel response:", result);

      // Reset streaming state
      clearStreamingState();
    } catch (error) {
      console.error("🔥 Error cancelling stream:", error);
      toast.error("Couldn’t stop the reply. Try Stop again.");
    }
  };

  const audioTiptapCallback = (text: string, setContent: boolean = false) => {
    if (editor) {
      setContent
        ? editor.chain().setContent(text).focus("end").run()
        : editor.chain().focus().insertContent(text).run();
    }
  };

  const toggleRecording = (val: boolean) => setIsRecording(val);

  const processAttachments = useCallback(
    async (
      editorHtml: string,
      fileItems: FileItem[]
    ): Promise<AiChatProcessedAttachment[]> => {
      const results: AiChatProcessedAttachment[] = [];
      const parser = new DOMParser();
      const doc = parser.parseFromString(editorHtml || "", "text/html");
      const imgTags = doc.querySelectorAll("img");
      let countBase64 = 0;

      for (const img of imgTags) {
        const url = img.getAttribute("src") || "";
        if (!url) continue;
        if (url.includes("ai-chat/attachments")) {
          // The file is already in storage, so send its URL. Fetching it back to base64
          // threw "Failed to fetch" on every attachment: the host serves no CORS header,
          // so the browser blocks the read (HTPR-4735). Both the chat route and the
          // persist route accept a hosted URL, and skipping the inline copy also keeps
          // the request small.
          const mimeType = getFileTypeFromUrl(url, IMAGE_FALLBACK_MIME);
          const fileName = url.substring(url.lastIndexOf("/") + 1);
          results.push({
            fileName,
            url,
            mimeType,
          });
        } else {
          const mimeType = getFileTypeFromBase64(url);
          results.push({
            fileName: `unknown-base64-${countBase64}`,
            url,
            mimeType,
          });
          countBase64++;
        }
      }

      for (const { file } of fileItems) {
        const dataUrl = (await convertFileToBase64(file)) as string;
        const mimeType =
          file.type ||
          getFileTypeFromBase64(dataUrl) ||
          "application/octet-stream";
        results.push({
          fileName: file.name,
          url: dataUrl,
          mimeType,
        });
      }

      return results;
    },
    []
  );

  // HTPR-4882: a guest's first words on their still-empty board build the board
  // instead of chatting about nothing. Posts the message into the thread first
  // so the chat shows what was asked plus the typing indicator while the
  // generator runs, then hard-navigates so the filled board loads clean.
  const buildGuestBoard = async (purpose: string, session: IChatSession) => {
    editor?.commands.clearContent();
    addMessageToSessionQuery(
      session.id,
      {
        id: Date.now().toString(),
        content: purpose,
        role: "human",
        createdAt: new Date(),
        sessionId: session.id,
        isDelivered: true,
      },
      false,
      false,
      scopedProjectId
    );
    setIsTyping(true);
    try {
      window.location.assign(await generateGuestBoard(purpose));
    } catch (error) {
      console.error("Error generating guest board:", error);
      setIsTyping(false);
      addMessageToSessionQuery(
        session.id,
        {
          id: Date.now().toString(),
          content:
            error instanceof Error
              ? error.message
              : "Could not create your board",
          role: "assistant",
          createdAt: new Date(),
          sessionId: session.id,
          isDelivered: true,
        },
        false,
        false,
        scopedProjectId
      );
    }
  };

  const waitForChatSession = async (timeoutMs = 5000) => {
    return ensureSessionForCurrentBoard(timeoutMs);
  };

  const handleSendMessage = async (
    retryContent?: string,
    options?: { htmlForAttachments?: string }
  ) => {
    if (isByokBlocked) return;

    // While a turn is streaming, composer Send/Enter appends to the FIFO queue
    // instead of starting a second stream (HTPR-5695). Use isTyping (not only
    // sendInFlight): the in-flight ref still blocks double-sends before the
    // stream starts, so a deferred+manual race cannot enqueue a duplicate of
    // the message that is still being prepared.
    if (retryContent === undefined && isTyping) {
      const content = (editor?.getText() ?? "").trim();
      if (!content) return;
      const files = [...fileUpload.fileItems];
      const queued = {
        id: crypto.randomUUID(),
        content,
        html: editor?.getHTML() ?? "",
        files,
      };
      messageQueueRef.current = [...messageQueueRef.current, queued];
      setQueuedMessages(messageQueueRef.current);
      editor?.commands.clearContent();
      fileUpload.clearFiles();
      return;
    }

    if (sendInFlightRef.current) return;

    //Step 1: Process content and get context
    const htmlContent = retryContent ?? editor?.getHTML() ?? "";
    const editorHtmlForAttachments = retryContent
      ? options?.htmlForAttachments ?? ""
      : editor?.getHTML() ?? "";
    let content = editor?.getText() ?? htmlContent;

    if (retryContent) {
      content = retryContent;
    }

    if (!content.trim()) return;
    sendInFlightRef.current = true;
    const taskAwareChatSurface =
      surface === "task_detail" || surface === "inbox";
    const streamTaskId =
      taskAwareChatSurface && inViewObject?.taskId
        ? inViewObject.taskId
        : undefined;

    try {
      const session = await waitForChatSession();
      if (!session) {
        toast.error("AI chat is still loading. Please try again.");
        return;
      }

      if (isGuestBoardBuild(currentProject)) {
        await buildGuestBoard(content.trim(), session);
        return;
      }

    const processedAttachments = await processAttachments(
      editorHtmlForAttachments,
      fileUpload.fileItems
    );

    const images64 = processedAttachments.filter((item) =>
      item.mimeType?.startsWith("image/")
    );
    const pdfs64 = processedAttachments.filter(
      (item) => item.mimeType === "application/pdf"
    );
    const docx64 = processedAttachments.filter(
      (item) =>
        item.mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );

    // Clear input
    // editor?.commands.blur();
    editor?.commands.clearContent();

    setIsTyping(true);

    const messageAttachments: IAttachment[] = processedAttachments.map(
      (item) => ({
        id: Date.now(),
        fileName: item.fileName,
        fileType: item.mimeType || "",
        fileSource: item.url,
        chatMessageId: session.id,
        createdAt: new Date(),
      })
    );
    const assistantMessageId = crypto.randomUUID();

    // Add user message to the conversation
    const userMessage: IChatMessage = {
      id: Date.now().toString(),
      content,
      role: "human",
      createdAt: new Date(),
      sessionId: session.id,
      isDelivered: true,
      attachments: messageAttachments,
    };

    const chatHistory = session.messages.map((message) => ({
      content: message.content,
      role: message.role,
    }));

    addMessageToSessionQuery(
      session.id,
      userMessage,
      false,
      false,
      scopedProjectId
    );

    if (!isFullScreenChat && dockedProjectId !== undefined) {
      setAiChatBoardSessionMap((previousMap) => ({
        ...previousMap,
        [dockedProjectId]: session.id,
      }));
    }

    // Prepare the streaming API request payload (auth via Authorization: Bearer)
    const streamId = crypto.randomUUID();
    const payload = {
      message: content,
      aiFeature: "aiChat",
      teamId: currentProject?.teamId,
      session_id: session.id,
      assistant_message_id: assistantMessageId,
      stream_id: streamId,
      context_list: contextList,
      modelOptionId: currentAiOption.id,
      model: currentAiOption.model,
      provider: currentAiOption.source,
      default_context: {
        // My Tasks, the inbox and the calendar span every board. Sending the
        // board the user happened to visit last would scope their questions to
        // it, which is the bug this surface field exists to end. A board they
        // picked deliberately in the scope selector still counts.
        project_id:
          spansAllBoards && !boardScopeIsExplicit ? undefined : scopedProjectId,
        surface,
        surface_path: pathname,
        // Active View = the saved filtered tab the user is on. Null appliedView means the default (all tasks) view, labelled by the board name.
        view_id: currentProject?.project_view?.user_project_views?.[0]?.appliedView?.id,
        view_name:
          currentProject?.project_view?.user_project_views?.[0]?.appliedView?.title ??
          currentProject?.title,
        ...(streamTaskId ? { task_id: streamTaskId } : {}),
      },
      user_context: {
        id: currentUser?.id,
        email: currentUser?.email,
        displayName: currentUser?.displayName,
      },
      chat_history: chatHistory,
      attachments: processedAttachments,
      images64,
      pdfs64,
      docx64,
      byokProviderFlags: billing?.byokProviderFlags ?? [],
      ...(isDemo
        ? {
            board_context: {
              title: currentProject?.title || currentProject?.name || "Demo board",
              columns: (currentProject?.sections ?? []).slice(0, 12).map((section) => ({
                title: section.section_title,
                tasks: section.items.slice(0, 30).map((task) => ({
                  title: task.title,
                  ...(task.ticketNumber ? { ticketNumber: task.ticketNumber } : {}),
                  ...(task.priority?.Priority_Value
                    ? { priority: task.priority.Priority_Value }
                    : {}),
                  labels: (task.taskLabels ?? [])
                    .map((taskLabel) => taskLabel.label?.value)
                    .filter((label): label is string => Boolean(label))
                    .slice(0, 8),
                })),
              })),
            },
          }
        : {}),
    };

    // Set current streaming session for cancellation
    streamingSessionRef.current = session.id;
    streamingAssistantMessageRef.current = assistantMessageId;
    setCurrentStreamingSession(session.id);
    streamingRequestRef.current = streamId;

    let assistantPlaceholderAdded = false;
    try {
      const response = await fetch(chatRoute, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok || !response.body) {
        throw new Error("Network response was not ok or body is missing");
      }

      fileUpload.clearFiles();

      // Create a new assistant message to update incrementally. The same UUID
      // is sent to the stream route so server persistence is idempotent.
      const initialAssistantMessage: IChatMessage = {
        id: assistantMessageId,
        content: "",
        role: "assistant",
        createdAt: new Date(),
        sessionId: session.id,
        isDelivered: false,
      };

      addMessageToSessionQuery(session.id, initialAssistantMessage, true);
      assistantPlaceholderAdded = true;

      // Process the streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let done = false;
      let aiContent = "";
      let buffer = "";
      let currentEventType = "";
      let streamErrorHandled = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          // Decode the chunk and add to buffer
          buffer += decoder.decode(value, { stream: true });

          // Process complete lines from the buffer
          const lines = buffer.split("\n");
          // Keep the last potentially incomplete line in the buffer
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            try {
              // Check if it's an SSE event line
              if (trimmedLine.startsWith("event:")) {
                currentEventType = trimmedLine.slice(6).trim();
                console.log("🔥 Event type set to:", currentEventType);
                continue;
              }

              // Check if it's a data line
              if (trimmedLine.startsWith("data:")) {
                const jsonData = trimmedLine.slice(5).trim();
                if (!jsonData) {
                  console.log("🔥 Empty data line, skipping");
                  continue;
                }

                console.log(
                  "🔥 Processing data with event type:",
                  currentEventType,
                  "Data:",
                  jsonData
                );
                const parsed = JSON.parse(jsonData);

                // Handle the message based on the event type instead of parsed.type
                switch (currentEventType) {
                  case "status":
                    console.log(`🔥 Received status: ${parsed.content}`);
                    setAgentStatus(parsed.content);
                    break;
                  case "thinking":
                    console.log(`🔥 Received thinking: ${parsed.content}`);
                    break;
                  case "content":
                    setAgentStatus(undefined);
                    aiContent += parsed.content;
                    // console.log(`🔥 aiContent after: "${aiContent}"`);

                    const initialAssistantMessage: IChatMessage = {
                      id: assistantMessageId,
                      content: aiContent,
                      role: "assistant",
                      createdAt: new Date(),
                      sessionId: session.id,
                      isDelivered: false,
                    };

                    addMessageToSessionQuery(
                      session.id,
                      initialAssistantMessage,
                      true,
                      true
                    );
                    break;
                  case "title":
                    updateSessionTitle(session.id, parsed.content);
                    break;
                  case "complete":
                    break;
                  case "error": {
                    setAgentStatus(undefined);
                    streamErrorHandled = true;
                    const rawError =
                      typeof parsed.content === "string" ? parsed.content : "";
                    const errorText = parseAiStreamErrorContent(rawError);
                    console.log("🔥 Received error event:", rawError);
                    const errorAssistantMessage: IChatMessage = {
                      id: assistantMessageId,
                      content: errorText,
                      role: "assistant",
                      createdAt: new Date(),
                      sessionId: session.id,
                      isDelivered: true,
                    };
                    addMessageToSessionQuery(
                      session.id,
                      errorAssistantMessage,
                      false,
                      true
                    );
                    setIsTyping(false);
                    break;
                  }
                  case "done":
                    setAgentStatus(undefined);
                    console.log("🔥 Stream complete:", parsed);
                    if (parsed.status === "error") {
                      if (!streamErrorHandled) {
                        const rawDone =
                          typeof parsed.content === "string"
                            ? parsed.content
                            : "";
                        const errorText = rawDone.trim()
                          ? parseAiStreamErrorContent(rawDone)
                          : "Sorry, an error occurred while processing your request.";
                        const errorMessage: IChatMessage = {
                          id: assistantMessageId,
                          content: errorText,
                          role: "assistant",
                          createdAt: new Date(),
                          isDelivered: true,
                          sessionId: session.id,
                        };
                        addMessageToSessionQuery(
                          session.id,
                          errorMessage,
                          false,
                          true
                        );
                        streamErrorHandled = true;
                      }
                    } else if (!streamErrorHandled) {
                      const initialAssistantMessage: IChatMessage = {
                        id: assistantMessageId,
                        content: aiContent,
                        role: "assistant",
                        createdAt: new Date(),
                        sessionId: session.id,
                        isDelivered: true,
                      };

                      addMessageToSessionQuery(
                        session.id,
                        initialAssistantMessage,
                        parsed.assistant_persisted === true,
                        true
                      );
                      if (streamTaskId != null) {
                        void refreshTaskComments(queryClient, streamTaskId).catch(
                          (error) =>
                            console.warn(
                              "[AI chat] task comments refresh failed",
                              error
                            )
                        );
                      }
                    }
                    setIsTyping(false);
                    break;
                  default:
                    setAgentStatus(undefined);
                    console.warn(
                      "🔥 Unknown event type:",
                      currentEventType,
                      "Data:",
                      parsed
                    );
                }
              }
            } catch (error) {
              setAgentStatus(undefined);
              console.error(
                "🔥 Error processing stream line:",
                error,
                "Line:",
                trimmedLine
              );
            }
          }
        }
      }
    } catch (error) {
      setAgentStatus(undefined);
      console.error("Error generating AI response:", error);
      const errorMessage: IChatMessage = {
        id: isDemo
          ? assistantMessageId
          : `transport-${assistantMessageId}`,
        content: isDemo
          ? "Sorry, I'm having trouble responding right now."
          : "Connection lost. Reopen this chat shortly to check for the completed reply.",
        role: "assistant",
        createdAt: new Date(),
        sessionId: session.id,
        isDelivered: true,
      };
      // A transport failure does not mean server generation failed. Keep this
      // notice outside persistence and under a temporary id so it can never
      // compete with the durable background reply's UUID.
      if (assistantPlaceholderAdded) {
        updateLastMessageInSessionCache(session.id, errorMessage);
      } else {
        appendMessageToSessionCache(session.id, errorMessage);
      }
      } finally {
        setAgentStatus(undefined);
        setIsTyping(false);
        streamingSessionRef.current = null;
        streamingAssistantMessageRef.current = null;
        streamingRequestRef.current = null;
        setCurrentStreamingSession(null); // Clear streaming session
        console.log("Message has been completed");
      }
    } finally {
      sendInFlightRef.current = false;
      // Auto-send the next queued follow-up once this turn settles (including
      // cancel/error). Keep the queue on Stop — only session switches clear it.
      queueMicrotask(() => {
        drainQueuedMessage();
      });
    }
  };
  handleSendMessageRef.current = handleSendMessage;

  const dropDownButtonAICallback = (selectedAiModel: TAiModal) => {
    setAiOption(selectedAiModel);
  };

  function handleRemoveContext(index: number) {
    const updatedContext = contextList.filter((x: any, idx) => idx !== index);
    setContextList(updatedContext);
  }

  function handleAddContext() {
    editor?.commands.focus("end");
    editor?.commands.insertContent(editor?.isEmpty ? "@" : " @");
  }

  // Latest values for the unmount handler below. They are read through refs
  // rather than closed over, because an effect that depends on them re-runs whenever
  // they change, and a cleanup that cancels the stream must not run on a re-render.
  const cancelContextRef = useRef({
    handleCancelStream,
  });
  // Written in an effect, not during render: a render can be thrown away, and a ref
  // assigned mid-render would then hold a value that never happened.
  useEffect(() => {
    cancelContextRef.current = {
      handleCancelStream,
    };
  });

  // Cancel an active stream only when the provider genuinely unmounts. A page
  // unload can be a mobile suspension/eviction; the server now finishes and
  // persists that reply even after the SSE client disconnects.
  //
  // This used to depend on [chatRoute, currentStreamingSession, token]. A cleanup runs
  // on every dependency change, not only on unmount, so the moment `token` resolved
  // (useMcpToken starts at null and fills in asynchronously) the cleanup fired and
  // cancelled the stream that was still running. Ctrl+K "Summarize ticket" hit this
  // constantly: it opens the chat and sends in the same breath, so the token almost
  // always landed mid-stream, the request was cancelled, and the summary never arrived.
  // Empty deps keep the cleanup to a real unmount; the refs above keep it current.
  useEffect(() => {
    return () => {
      if (streamingSessionRef.current) cancelContextRef.current.handleCancelStream();
    };
  }, []);

  // `editor` is in the deps because it now arrives asynchronously (HTPR-4508):
  // on the first open of a page load the chat is shown before the editor chunk
  // has loaded, so focusing only on the flag would leave the caret on the board
  // and send the user's next keystroke to the page-level shortcut handler.
  useEffect(() => {
    if (showAiChatInterface) editor?.commands.focus("end");
  }, [showAiChatInterface, editor]);

  useEffect(() => {
    setChatMounted(showAiChatInterface);
  }, [showAiChatInterface]);

  // Reopen the chat after a page reload (HTPR-4687). Deliberately sessionStorage and not
  // the persisted atom store: #1935 removed localStorage persistence because relaunching
  // the app is the last-resort escape from a chat you cannot dismiss, and localStorage
  // dropped you straight back into it. sessionStorage dies with the tab, so the reload
  // case is restored and the escape hatch survives.
  //
  // Skipped on mobile, matching every other auto-open path (LandingPage, TaskDetailComp):
  // there the chat is a full-height sheet, and reload is the move a stuck user actually
  // makes, so restoring it there would weaken the escape hatch rather than preserve it.
  // The viewport is read directly instead of via MobileViewContext, which is still false
  // on this pass — the provider only sets it in a layout effect, so trusting it here would
  // reopen the sheet on a phone before the context caught up.
  // Skipped without a signed-in user so a logged-out tab does not reopen it over /login.
  useEffect(() => {
    if (hasAttemptedRestoreRef.current || !currentUser?.id) return;
    hasAttemptedRestoreRef.current = true;
    if (window.innerWidth < MOBILE_VIEWPORT_MAX_PX) return;
    if (readChatOpenForSession()) {
      setChatMounted(true);
      setShowAIChat(true);
    }
  }, [currentUser?.id]);

  // Gated on the restore having been attempted: this effect also runs on mount, where it
  // would otherwise stamp "0" over the stored "1" before a late-arriving currentUser let
  // the restore read it, silently killing the feature.
  useEffect(() => {
    if (!hasAttemptedRestoreRef.current) return;
    writeChatOpenForSession(showAiChatInterface);
  }, [showAiChatInterface]);

  const handleMessageListScroll = (element?: HTMLElement | null) => {
    const target = element ?? messageListRef.current;
    if (!target) {
      setShowScrollUpIndicator(false);
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = target;

    if (scrollTop + clientHeight >= scrollHeight - 4) {
      setShowScrollUpIndicator(false);
    } else {
      setShowScrollUpIndicator(true);
    }
  };

  const registerMessageListRef = (element: HTMLDivElement | null) => {
    messageListRef.current = element;
  };

  const scrollMessagesToBottom = (behavior: ScrollBehavior = "smooth") => {
    const target = messageListRef.current;
    if (!target) return;
    target.scrollTo({
      top: target.scrollHeight,
      behavior,
    });
  };

  async function copyResponse(message: IChatMessage) {
    try {
      const html = message.content?.toString() ?? "";
      // message.content is HTML — derive a plain-text version so pasting into
      // plain-text targets works (an html-only ClipboardItem pastes nothing there)
      const div = document.createElement("div");
      div.innerHTML = html;
      const plain = div.innerText;

      if (
        navigator.clipboard &&
        typeof navigator.clipboard.write === "function"
      ) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }

      if (message.role === "human") {
        toast.success(`Query copied to clipboard`);
      } else {
        toast.success(`Response copied to clipboard`);
      }
    } catch (err) {
      console.log("🚀 ~ MessageItem ~ err:", err);
      toast.error("Unable to copy response");
    }
  }

  function createTaskFromResponse(message: IChatMessage) {
    //we gonna preset the task description. I forgot how we could do this. need to check. Man i am terribly tired.
    const content = message.content;

    toggleCreateTaskGlobally({
      sectionId: inViewObject?.sectionId!,
      sectionTitle: inViewObject.sectionTitle ?? "",
      position: "top",
      prefilledDescription: `${content}`,
    });
  }

  const toggleRenameChatModal = () => setShowRenameChatModal((prev) => !prev);

  const renameChat = (newTitle: string) => {
    const sessionId = currentSession?.id ?? activeSession;
    if (!sessionId) {
      setShowRenameChatModal(false);
      return;
    }
    updateSessionTitle(sessionId, newTitle);
    setShowRenameChatModal(false);
  };

  return {
    minimized,
    minimizeChat,
    restoreChat,
    isTyping,
    isRecording,
    queuedMessages,
    removeQueuedMessage,
    isByokBlocked,
    sessions,
    activeSession,
    currentSession,
    showWelcomeScreen,
    isSessionPending,
    chatHistoryReady,
    isSidebarMode,
    setIsSidebarMode,
    chatMounted,
    setChatMounted,
    currentAiOption,
    displayAiOptions,
    editor,
    editorEnabled,
    editorMountProps,
    contextList,
    showAiChatInterface,
    setShowAIChat,
    setAiChatAutoOpenSuppressed,
    isDetailPage,
    showScrollUpIndicator,
    agentStatus,
    showRenameChatModal,
    togglePopover,
    setIsTyping,
    toggleSidebarMode,
    dropDownButtonAICallback,
    tiptapKeydown,
    layoutKeydown,
    handleRemoveContext,
    handleAddContext,
    handleSendMessage,
    handleMessageListScroll,
    registerMessageListRef,
    scrollMessagesToBottom,
    copyResponse,
    editMessage,
    createTaskFromResponse,
    handleCancelStream,
    retryStream,
    audioTiptapCallback,
    toggleRecording,
    startNewSession,
    selectSession,
    toggleRenameChatModal,
    renameChat,
    deleteSession,
    ...fileUpload,
  };
}
