import type { SessionStreams } from "@/lib/aiChat/sessionStreams";
import { getNativeSidebarChat } from "@/lib/agents/chatViewerState";
import { useCallback, useEffect, useRef } from "react";
import globalConstants from "@/lib/constants";
import { IChatSession } from "@/models/model";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { useFileUpload } from "@/components/Common/AttachmentsUpload/FileUploadHandler";
import { shouldBlockAiDueToByokProvider } from "@/lib/byokSelectedProviderGate";
import { isGuestCookieUser } from "@/lib/demo/isGuestClient";
import type { useAiChatState } from "./useAiChatState";
import { HTPR_7736_CHAT_FOLLOWS_TASK_FLAG } from "@/lib/flags/definitions/htpr-7736-chat-follows-task";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7762_CHAT_NEW_SESSION_FOCUS_FLAG } from "@/lib/flags/definitions/htpr-7762-chat-new-session-focus";
import type { QueuedAiChatMessage, SessionMessageQueue } from "@/lib/aiChat/sessionMessageQueue";

type Context = { navigationKey?: string | null; parallelStreams?: SessionStreams; agentSidebarChatsEnabled: boolean; persistentQueue?: SessionMessageQueue } & Pick<ReturnType<typeof useAiChatState>, "sessionIntentGenerationRef" | "sessionSetupRef" | "resolvedBoardSessionRef" | "clearMessageQueue" | "selectSessionInHistory" | "createSession" | "editor" | "isFullScreenChat" | "setDockedChatScope" | "currentProject" | "previousProjectIdRef" | "deleteSessionInHistory" | "manualChat" | "messageQueueRef" | "setQueuedMessages" | "sendInFlightRef" | "modelBilling" | "currentAiOption" | "pathname" | "currentUser" | "taskId" | "sessionsRef" | "dockedChatScope" | "sessionContextKey" | "chatHistoryReadyRef" | "aiChatBoardSessionMap" | "setAiChatBoardSessionMap" | "setRecentChatBoardIds" | "shouldLoadChatHistory" | "resolveHistorySession" | "getDisplayedSession" | "sessionPagingEnabled">;

export function useAiChatSessions(context: Context) {
  const followsTaskNavigation = useFlag(HTPR_7736_CHAT_FOLLOWS_TASK_FLAG);
  const newSessionFocusEnabled = useFlag(HTPR_7762_CHAT_NEW_SESSION_FOCUS_FLAG);
  const {
  navigationKey, parallelStreams, sessionIntentGenerationRef, sessionSetupRef, resolvedBoardSessionRef, clearMessageQueue, selectSessionInHistory,
  createSession, editor, isFullScreenChat, setDockedChatScope, currentProject, previousProjectIdRef,
  deleteSessionInHistory, messageQueueRef, persistentQueue, setQueuedMessages, sendInFlightRef, modelBilling,
  currentAiOption, pathname, currentUser, taskId, manualChat, sessionsRef,
  dockedChatScope, sessionContextKey, chatHistoryReadyRef, aiChatBoardSessionMap, setAiChatBoardSessionMap,
  setRecentChatBoardIds, shouldLoadChatHistory, resolveHistorySession, getDisplayedSession,
  sessionPagingEnabled,
  } = context;

  const selectSession = useCallback((sessionId: string) => {
    sessionIntentGenerationRef.current += 1;
    sessionSetupRef.current = null;
    resolvedBoardSessionRef.current = null;
    if (!persistentQueue) clearMessageQueue();
    selectSessionInHistory(sessionId);
  }, [clearMessageQueue, selectSessionInHistory, persistentQueue]);
  const startNewSession = useCallback(async () => {
    const generation = sessionIntentGenerationRef.current + 1;
    sessionIntentGenerationRef.current = generation;
    sessionSetupRef.current = null;
    resolvedBoardSessionRef.current = null;
    if (!persistentQueue) clearMessageQueue();
    const createdSession = await createSession(
      () => sessionIntentGenerationRef.current === generation
    );
    if (sessionIntentGenerationRef.current !== generation) return;
    if (!navigationKey && !isFullScreenChat) setDockedChatScope(null);
    const projectId = currentProject?.id;
    if (createdSession && typeof projectId === "number") {
      resolvedBoardSessionRef.current = { projectId, session: createdSession };
      previousProjectIdRef.current = projectId;
    }
    if (newSessionFocusEnabled && isFullScreenChat && createdSession) {
      editor?.commands.focus("end");
    }
    return createdSession;
  }, [
    clearMessageQueue,
    navigationKey,
    persistentQueue,
    createSession,
    currentProject?.id,
    editor,
    isFullScreenChat,
    newSessionFocusEnabled,
    setDockedChatScope,
  ]);

  const deleteSession = useCallback(async (sessionId: string) => {
    sessionIntentGenerationRef.current += 1;
    sessionSetupRef.current = null;
    if (resolvedBoardSessionRef.current?.session.id === sessionId) {
      resolvedBoardSessionRef.current = null;
    }
    const deleted = await deleteSessionInHistory(sessionId);
    if (deleted && parallelStreams) {
      persistentQueue?.set(sessionId, []);
      parallelStreams.remove(sessionId);
    }
  }, [deleteSessionInHistory, parallelStreams, persistentQueue]);

  const fileUpload = useFileUpload();
  const fileUploadRef = useRef(fileUpload);
  fileUploadRef.current = fileUpload;
  const handleSendMessageRef = useRef<
    (
      retryContent?: string,
      options?: { htmlForAttachments?: string; queuedMessage?: QueuedAiChatMessage; sessionId?: string; onQueueBusy?: (retryAfterMs: number) => void }
    ) => Promise<boolean>
  >(async () => false);

  const removeQueuedMessage = useCallback((id: string) => {
    if (persistentQueue) {
      const sessionId = persistentQueue.sessionId;
      if (sessionId) persistentQueue.set(sessionId, persistentQueue.get(sessionId).filter((item) => item.id !== id));
      return;
    }
    messageQueueRef.current = messageQueueRef.current.filter(
      (item) => item.id !== id
    );
    setQueuedMessages(messageQueueRef.current);
  }, [persistentQueue]);

  const drainingRef = useRef(false);
  const retryAtRef = useRef(0);
  const drainQueuedMessage = useCallback((finishedSessionId?: string) => {
    const targetSessionId = finishedSessionId ?? persistentQueue?.sessionId;
    const runtime = targetSessionId ? parallelStreams?.get(targetSessionId) : undefined;
    if (runtime ? runtime.sendInFlightRef.current : sendInFlightRef.current) return;
    if (runtime ? runtime.draining || Date.now() < runtime.retryAt : drainingRef.current || Date.now() < retryAtRef.current) return;
    if (persistentQueue) {
      const sessionId = runtime ? targetSessionId : persistentQueue.sessionId;
      if (!sessionId || (!runtime && finishedSessionId && sessionId !== finishedSessionId)) return;
      const next = persistentQueue.get(sessionId)[0];
      if (!next) return;
      const send = runtime ? runtime.send : handleSendMessageRef.current;
      if (!send) return;
      if (runtime) runtime.draining = true;
      else drainingRef.current = true;
      const retry = (delay: number) => {
        if (runtime) runtime.retryAt = Date.now() + delay;
        else retryAtRef.current = Date.now() + delay;
      };
      let retryDelay = 15000;
      void send(next.content, { queuedMessage: next, sessionId, onQueueBusy: (delay) => { retryDelay = delay; } })
        .then((sent) => {
          if (sent) persistentQueue.set(sessionId, persistentQueue.get(sessionId).filter((item) => item.id !== next.id));
          else retry(retryDelay);
        })
        .catch((error) => {
          retry(retryDelay);
          console.error("Could not send queued chat message:", error);
        })
        .finally(() => {
          if (runtime) {
            runtime.draining = false;
            if (!runtime.retryAt || runtime.retryAt <= Date.now()) queueMicrotask(() => drainQueuedMessage(sessionId));
          } else drainingRef.current = false;
        });
      return;
    }
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
  }, [persistentQueue, parallelStreams]);
  useEffect(() => {
    if (!persistentQueue) return;
    const drain = () => {
      if (parallelStreams) {
        for (const sessionId of parallelStreams.sessionIds()) drainQueuedMessage(sessionId);
      } else drainQueuedMessage();
    };
    if (!parallelStreams) retryAtRef.current = 0;
    drain();
    const timer = window.setInterval(drain, 2000);
    return () => window.clearInterval(timer);
  }, [persistentQueue, persistentQueue?.sessionId, parallelStreams, drainQueuedMessage]);
  const billing = modelBilling;
  const isApple = useDeviceContext();
  const isByokBlocked = shouldBlockAiDueToByokProvider(billing, currentAiOption?.source);
  const isDemo = (pathname?.startsWith("/demo") ?? false) || isGuestCookieUser();
  const chatRoute = isDemo
    ? "/api/demo/chat/stream"
    : globalConstants.sendAiChatMessageRoute;

  const ensureSessionForCurrentBoard = useCallback(async (timeoutMs = 5000) => {
    const projectId = currentProject?.id;
    const userId = currentUser?.id;
    const sidebarNative = context.agentSidebarChatsEnabled ? getNativeSidebarChat() : null;
    if (sidebarNative && sidebarNative.projectId === projectId) {
      return sessionPagingEnabled
        ? await resolveHistorySession(sidebarNative.sessionId)
        : sessionsRef.current.find((session) => session.id === sidebarNative.sessionId);
    }

    if (taskId !== undefined && !manualChat) {
      if (sessionPagingEnabled || navigationKey) {
        const generation = sessionIntentGenerationRef.current;
        const deadline = Date.now() + timeoutMs;
        while (!chatHistoryReadyRef.current && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (sessionIntentGenerationRef.current !== generation) return undefined;
        }
        if (!chatHistoryReadyRef.current || sessionIntentGenerationRef.current !== generation) return undefined;
        const selected = getDisplayedSession();
        return selected?.userId === userId ? selected : undefined;
      }
      if (followsTaskNavigation && !isFullScreenChat) {
        const selected = getDisplayedSession();
        return selected?.userId === userId ? selected : undefined;
      }
      const matchesTask = (session: IChatSession) => session.taskId === taskId;
      const generation = sessionIntentGenerationRef.current;
      const deadline = Date.now() + timeoutMs;
      while (
        !sessionsRef.current.some(matchesTask) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (sessionIntentGenerationRef.current !== generation) return undefined;
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
        (sessionPagingEnabled ? !chatHistoryReadyRef.current :
          !sessionsRef.current.some((session) => session.userId === userId) && !chatHistoryReadyRef.current) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!isCurrentIntent() || ((sessionPagingEnabled || navigationKey) && !chatHistoryReadyRef.current)) return undefined;

      const currentSessions = sessionsRef.current.filter(
        (session) => session.userId === userId
      );
      if (navigationKey) {
        const selected = getDisplayedSession();
        if (selected) return selected.userId === userId && !selected.agentId ? selected : undefined;
        const created = await createSession(isCurrentIntent);
        return isCurrentIntent() ? created : undefined;
      }
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
        return sessionPagingEnabled || parallelStreams ? getDisplayedSession() : currentSessions[0];
      }
      if (!isCurrentIntent()) return undefined;

      if (previousProjectIdRef.current === projectId) {
        if (sessionPagingEnabled || parallelStreams) {
          resolvedBoardSessionRef.current = null;
          return getDisplayedSession();
        }
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
        ) ?? (sessionPagingEnabled ? await resolveHistorySession(mappedSessionId) : undefined);
        if (!isCurrentIntent()) return undefined;
        if (mappedSession && !mappedSession.agentId && (!sessionPagingEnabled || (mappedSession.taskId === null && mappedSession.projectId === projectId))) {
          if (mappedSession.id !== currentSessions[0].id) {
            resolvedBoardSessionRef.current = {
              projectId,
              session: mappedSession,
            };
            if (sessionPagingEnabled) {
              await selectSessionInHistory(mappedSession.id);
              if (!isCurrentIntent()) return undefined;
            }
            else selectSessionInHistory(mappedSession.id);
          }
          previousProjectIdRef.current = projectId;
          return sessionPagingEnabled ? getDisplayedSession() : mappedSession;
        }

        setAiChatBoardSessionMap((previousMap) => {
          const nextMap = { ...previousMap };
          delete nextMap[projectId];
          return nextMap;
        });
      }

      if (sessionPagingEnabled) {
        const scopedSession = await resolveHistorySession(undefined, { projectId });
        if (!isCurrentIntent()) return undefined;
        if (scopedSession && !scopedSession.agentId) {
          resolvedBoardSessionRef.current = { projectId, session: scopedSession };
          await selectSessionInHistory(scopedSession.id);
          if (!isCurrentIntent()) return undefined;
          previousProjectIdRef.current = projectId;
          return getDisplayedSession();
        }
      }

      if (sessionPagingEnabled) {
        const emptySession = await resolveHistorySession(undefined, undefined, true);
        if (!isCurrentIntent()) return undefined;
        if (emptySession && !emptySession.agentId) {
          resolvedBoardSessionRef.current = { projectId, session: emptySession };
          await selectSessionInHistory(emptySession.id);
          if (!isCurrentIntent()) return undefined;
          previousProjectIdRef.current = projectId;
          return getDisplayedSession();
        }
      }
      if (sessionPagingEnabled && getDisplayedSession()?.id !== currentSessions[0]?.id && !getDisplayedSession()?.agentId) return getDisplayedSession();
      if (!currentSessions[0].agentId && (!sessionPagingEnabled || currentSessions[0].taskId === null) && (currentSessions[0].messages?.length ?? 0) === 0) {
        previousProjectIdRef.current = projectId;
        return sessionPagingEnabled ? getDisplayedSession() : currentSessions[0];
      }

      const emptySession = currentSessions.find(
        (session) => !session.agentId && (!sessionPagingEnabled || session.taskId === null) && (session.messages?.length ?? 0) === 0
      );
      if (emptySession) {
        resolvedBoardSessionRef.current = { projectId, session: emptySession };
        selectSessionInHistory(emptySession.id);
        previousProjectIdRef.current = projectId;
        return sessionPagingEnabled ? getDisplayedSession() : emptySession;
      }

      const createdSession = await createSession(isCurrentIntent);
      if (!isCurrentIntent()) return undefined;
      if (createdSession) {
        resolvedBoardSessionRef.current = { projectId, session: createdSession };
        previousProjectIdRef.current = projectId;
      }
      return sessionPagingEnabled ? getDisplayedSession() : createdSession;
    })();

    sessionSetupRef.current = { key: setupKey, promise };
    const clearSetup = () => {
      if (sessionSetupRef.current?.promise === promise) {
        sessionSetupRef.current = null;
      }
    };
    if (sessionPagingEnabled) void promise.then(clearSetup, clearSetup);
    else void promise.finally(clearSetup);
    return promise;
  }, [
    aiChatBoardSessionMap,
    navigationKey,
    context.agentSidebarChatsEnabled,
    createSession,
    currentProject?.id,
    currentUser?.id,
    dockedChatScope,
    isFullScreenChat,
    pathname,
    sessionContextKey,
    selectSessionInHistory,
    setAiChatBoardSessionMap,
    taskId, manualChat, sessionPagingEnabled, parallelStreams, resolveHistorySession, getDisplayedSession, followsTaskNavigation,
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
    if (!shouldLoadChatHistory || manualChat || navigationKey) return;
    if (sessionPagingEnabled) void ensureSessionForCurrentBoard().catch((error) => console.error("Error resolving chat session:", error));
    else void ensureSessionForCurrentBoard();
  }, [ensureSessionForCurrentBoard, shouldLoadChatHistory, sessionPagingEnabled, manualChat, navigationKey]);
  return {
  selectSession, startNewSession, deleteSession, fileUpload, handleSendMessageRef,
  removeQueuedMessage, drainQueuedMessage, billing, isApple, isByokBlocked,
  isDemo, chatRoute, ensureSessionForCurrentBoard,
  };
}
