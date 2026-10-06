import { useFlag } from "@/hooks/useFlag";
import { HTPR_6924_REST_COMPAT_FLAG } from "@/lib/flags/keys";
import { useCallback, useEffect, useRef } from "react";
import globalConstants from "@/lib/constants";
import { IChatSession } from "@/models/model";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { useFileUpload } from "@/components/Common/AttachmentsUpload/FileUploadHandler";
import { shouldBlockAiDueToByokProvider } from "@/lib/byokSelectedProviderGate";
import { isGuestCookieUser } from "@/lib/demo/isGuestClient";
import type { useAiChatState } from "./useAiChatState";

type Context = Pick<ReturnType<typeof useAiChatState>, "sessionIntentGenerationRef" | "sessionSetupRef" | "resolvedBoardSessionRef" | "clearMessageQueue" | "selectSessionInHistory" | "createSession" | "isFullScreenChat" | "setDockedChatScope" | "currentProject" | "previousProjectIdRef" | "deleteSessionInHistory" | "messageQueueRef" | "setQueuedMessages" | "sendInFlightRef" | "modelBilling" | "currentAiOption" | "pathname" | "currentUser" | "taskId" | "sessionsRef" | "dockedChatScope" | "sessionContextKey" | "chatHistoryReadyRef" | "aiChatBoardSessionMap" | "setAiChatBoardSessionMap" | "setRecentChatBoardIds" | "shouldLoadChatHistory" | "resolveHistorySession">;

export function useAiChatSessions(context: Context) {
  const {
  sessionIntentGenerationRef, sessionSetupRef, resolvedBoardSessionRef, clearMessageQueue, selectSessionInHistory,
  createSession, isFullScreenChat, setDockedChatScope, currentProject, previousProjectIdRef,
  deleteSessionInHistory, messageQueueRef, setQueuedMessages, sendInFlightRef, modelBilling,
  currentAiOption, pathname, currentUser, taskId, sessionsRef,
  dockedChatScope, sessionContextKey, chatHistoryReadyRef, aiChatBoardSessionMap, setAiChatBoardSessionMap,
  setRecentChatBoardIds, shouldLoadChatHistory, resolveHistorySession,
  } = context;
  const restCompat = useFlag(HTPR_6924_REST_COMPAT_FLAG);
  let setupFlagKey = "legacy";
  if (restCompat) setupFlagKey = HTPR_6924_REST_COMPAT_FLAG;

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
    ) => Promise<boolean>
  >(async () => false);

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
  const billing = modelBilling;
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
      if (restCompat) {
        const generation = sessionIntentGenerationRef.current;
        const deadline = Date.now() + timeoutMs;
        while (!chatHistoryReadyRef.current && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (sessionIntentGenerationRef.current !== generation) return undefined;
        }
        if (!chatHistoryReadyRef.current || sessionIntentGenerationRef.current !== generation) return undefined;
        const selected = sessionsRef.current[0];
        return selected?.userId === userId ? selected : undefined;
      }
      // Match on taskId alone, same as the find-or-create init effect in
      // useSessionAndChatHistory - sessions are already scoped to the
      // signed-in user server-side, so requiring userId here too just adds
      // a second, easy-to-drift copy of that rule.
      const matchesTask = (session: IChatSession) => session.taskId === taskId;
      // Ticket switches and explicit session picks bump this generation, so
      // a send that outlives the user's navigation away from this ticket
      // doesn't land in a conversation they can no longer see (HTPR-6100).
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
    const setupKey = `${setupFlagKey}:${sessionContextKey}:${
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
        (restCompat ? !chatHistoryReadyRef.current :
          !sessionsRef.current.some((session) => session.userId === userId) && !chatHistoryReadyRef.current) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!isCurrentIntent() || (restCompat && !chatHistoryReadyRef.current)) return undefined;

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
          if (restCompat && !currentSessions.some((session) => session.id === resolved.session.id)) {
            const stillExists = await resolveHistorySession(resolved.session.id);
            if (!isCurrentIntent()) return undefined;
            if (stillExists) return stillExists;
            resolvedBoardSessionRef.current = null;
            return currentSessions[0];
          }
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
        ) ?? (restCompat ? await resolveHistorySession(mappedSessionId) : undefined);
        if (!isCurrentIntent()) return undefined;
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

      if (restCompat) {
        const scopedSession = await resolveHistorySession(undefined, { projectId });
        if (!isCurrentIntent()) return undefined;
        if (scopedSession) {
          resolvedBoardSessionRef.current = { projectId, session: scopedSession };
          selectSessionInHistory(scopedSession.id);
          previousProjectIdRef.current = projectId;
          return scopedSession;
        }
      }

      if (restCompat) {
        const emptySession = await resolveHistorySession(undefined, undefined, true);
        if (!isCurrentIntent()) return undefined;
        if (emptySession) {
          resolvedBoardSessionRef.current = { projectId, session: emptySession };
          selectSessionInHistory(emptySession.id);
          previousProjectIdRef.current = projectId;
          return emptySession;
        }
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
    const clearSetup = () => {
      if (sessionSetupRef.current?.promise === promise) {
        sessionSetupRef.current = null;
      }
    };
    void promise.then(clearSetup, clearSetup);
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
    taskId, restCompat, resolveHistorySession, setupFlagKey,
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
    if (shouldLoadChatHistory) void ensureSessionForCurrentBoard().catch((error) => console.error("Error resolving chat session:", error));
  }, [ensureSessionForCurrentBoard, shouldLoadChatHistory]);
  return {
  selectSession, startNewSession, deleteSession, fileUpload, handleSendMessageRef,
  removeQueuedMessage, drainQueuedMessage, billing, isApple, isByokBlocked,
  isDemo, chatRoute, ensureSessionForCurrentBoard,
  };
}
