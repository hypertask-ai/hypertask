import { useFlag } from "@/hooks/useFlag";
import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_6924_REST_COMPAT_FLAG } from "@/lib/flags/keys";
import { currentUserAtom, composeTaskChatIntroAtom } from "@/store";
import type { ApiResponse } from "@/utils/axiosClient";
import {
  AI_Chat_API,
  type TAllChatSessionsResponse,
  type ChatSessionScope,
} from "@/utils/api/ai_chat";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { IChatMessage, IChatSession, IUser } from "@/models/model";
import { usePathname } from "next/navigation";
import { usePagedChatHistory } from "./usePagedChatHistory";

const createDemoSession = (user: IUser): IChatSession => {
  const now = new Date();
  return {
    id: `demo-chat-${now.getTime()}-${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    userId: user.id,
    user,
    title: "AI Chat",
    taskId: null,
    messages: [],
  };
};

export const useSessionAndChatHistory = (
  taskId?: number,
  historyEnabled = true,
  // True on pages that always resolve to a task (e.g. the ticket detail
  // page). There, `taskId === undefined` only ever means "the task hasn't
  // loaded into view yet", never "there is no task" - so the init effect
  // below must wait for it instead of grabbing whatever session was last
  // active on a different ticket (HTPR-6100).
  isTaskScoped = false
) => {
  const restCompat = useFlag(HTPR_6924_REST_COMPAT_FLAG);
  const composeEnabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const [pendingComposeIntro, setComposeIntro] = useRecoilState(composeTaskChatIntroAtom);
  let composeIntro: typeof pendingComposeIntro = null;
  if (composeEnabled) composeIntro = pendingComposeIntro;
  const consumedComposeIntro = useRef<string | null>(null);
  const currentUser = useRecoilValue(currentUserAtom);
  const pathname = usePathname();
  const isDemo = pathname?.startsWith("/demo") ?? false;
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [demoSessions, setDemoSessions] = useState<IChatSession[]>([]);
  const queryClient = useQueryClient();
  // Tracks the taskId we've already asked the API to create a fresh session
  // for, so the init effect below doesn't fire createSessionNext twice while
  // the first request is still in flight (sessionsData changes as soon as it
  // resolves, re-running the effect).
  const startingSessionForTaskRef = useRef<number | null>(null);
  // Always holds the taskId as of the most recent render, so an in-flight
  // create started for an earlier ticket can tell it's stale once the user
  // has switched tickets, instead of committing its session as active.
  const currentTaskIdRef = useRef<number | undefined>(taskId);
  currentTaskIdRef.current = taskId;

  const hasRequiredData = !!currentUser?.uid;
  let paged = false;
  if (restCompat && !isDemo) paged = true;
  const pagedHistory = usePagedChatHistory(paged, currentUser, taskId, historyEnabled, isTaskScoped);
  const cacheKey = ["chat-sessions", currentUser?.uid];
  const cacheIdentity = `${currentUser?.uid}:${currentUser?.id}:${paged}`;
  const cacheIdentityRef = useRef(cacheIdentity);
  cacheIdentityRef.current = cacheIdentity;
  const identity = `${cacheIdentity}:${taskId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const previousIdentityRef = useRef(identity);
  useEffect(() => {
    if (previousIdentityRef.current === identity) return;
    previousIdentityRef.current = identity;
    setActiveSession(null);
    setMounted(false);
    startingSessionForTaskRef.current = null;
  }, [identity]);

  // ChatProvider stays mounted so global shortcuts keep working, but the
  // session payload is secondary startup data. Do not request it until the
  // chat is visible (or the user has otherwise expressed chat intent).
  const {
    data: sessionsData,
    isLoading: isLoadingSessions,
    isFetching: isFetchingSessions,
    isError: isErrorSessions,
    isSuccess: legacySessionsReady,
  } = useQuery({
    queryKey: cacheKey,
    queryFn: () => {
      if (!currentUser?.uid) {
        throw new Error("Missing required user data");
      }
      return AI_Chat_API.getAllSessions();
    },
    enabled: historyEnabled && hasRequiredData && !isDemo && !paged,
    staleTime: 1000 * 60 * 3,
  });


  const resolveHistorySession = useCallback(async (sessionId?: string, scope?: ChatSessionScope) => sessionsData?.data.sessions.find((session) =>
    sessionId ? session.id === sessionId :
      (!scope?.taskId || session.taskId === scope.taskId) &&
      (!scope?.projectId || session.projectId === scope.projectId)), [sessionsData]);

  const startNewSession = useCallback(async (
    shouldCommit: () => boolean = () => true
  ) => {
    if (!hasRequiredData || !currentUser?.uid) {
      console.warn("Cannot start new session: missing user data");
      return;
    }

    if (isDemo) {
      if (!shouldCommit()) return;
      // ponytail: anonymous demo conversations live only in memory. They never
      // touch the cookie-authenticated chat-session persistence routes.
      const session = createDemoSession(currentUser);
      setDemoSessions((previous) => [session, ...previous]);
      setActiveSession(session.id);
      setMounted(true);
      return session;
    }

    const requestedIdentity = identityRef.current;
    try {
      const res = await AI_Chat_API.createSessionNext(taskId);
      const body = res.data;

      if (!body?.success || !body.session?.id) {
        console.warn("Invalid create session response from API");
        return;
      }

      const newSession = body.session;
      const newSessionId = newSession.id;
      if (!shouldCommit() || requestedIdentity !== identityRef.current) return;

      queryClient.setQueryData<ApiResponse<TAllChatSessionsResponse>>(
        cacheKey,
        (old) => {
          const nextSessions = [newSession, ...(old?.data?.sessions ?? [])];
          if (!old) {
            return {
              data: { success: true, sessions: nextSessions },
              status: res.status,
              statusText: res.statusText,
              headers: res.headers,
              config: res.config,
            };
          }
          return {
            ...old,
            data: {
              ...old.data,
              success: true,
              sessions: nextSessions,
            },
          };
        }
      );

      setActiveSession(newSessionId);
      setMounted(true);
      return newSession;
    } catch (error) {
      console.log("🚀 ~ useSessionAndChatHistory ~ error:", error);
    }
  }, [hasRequiredData, currentUser?.uid, currentUser?.id, isDemo, queryClient, taskId, paged]);

  const selectSession = useCallback(
    async (sessionId: string) => {
      if (!hasRequiredData || !currentUser?.uid) {
        console.warn("Cannot select session: missing user data");
        return;
      }

      const requestedIdentity = identityRef.current;
      try {
        if (isDemo) {
          setDemoSessions((previous) => {
            const selected = previous.find((session) => session.id === sessionId);
            return selected
              ? [selected, ...previous.filter((session) => session.id !== sessionId)]
              : previous;
          });
          setActiveSession(sessionId);
          setMounted(true);
          return;
        }

        queryClient.setQueryData<ApiResponse<TAllChatSessionsResponse>>(
          cacheKey,
          (old) => {
            if (!old?.data?.sessions?.length) return old;

            const sessions = old.data.sessions;
            const index = sessions.findIndex((s) => s.id === sessionId);
            if (index <= 0) return old;

            const selected = sessions[index];
            const rest = sessions.filter((_, i) => i !== index);
            return {
              ...old,
              data: {
                ...old.data,
                sessions: [selected, ...rest],
              },
            } as ApiResponse<TAllChatSessionsResponse>;
          }
        );

        setActiveSession(sessionId);
        setMounted(true);
      } catch (error) {
        if (requestedIdentity === identityRef.current) console.error("Error selecting session:", error);
      }
    },
    [hasRequiredData, currentUser?.uid, currentUser?.id, isDemo, queryClient, paged, resolveHistorySession]
  );

  const addMessageToSessionQuery = useCallback(
    (
      sessionId: string,
      message: IChatMessage,
      queryOnly = false,
      updateLastMessage = false,
      projectId?: number
    ) => {
      if (!hasRequiredData || !currentUser?.uid) {
        console.warn("Cannot add message to session: missing user data");
        return;
      }

      const requestedIdentity = identityRef.current;
      const requestedCacheIdentity = cacheIdentityRef.current;
      try {
        if (isDemo) {
          setDemoSessions((previous) =>
            previous.map((session) => {
              if (session.id !== sessionId) return session;
              const previousMessages = session.messages ?? [];
              const messages = updateLastMessage
                ? previousMessages.length > 0
                  ? [...previousMessages.slice(0, -1), message]
                  : [message]
                : [...previousMessages, message];
              return { ...session, messages, updatedAt: new Date() };
            }),
          );
          return;
        }

        // Optimistically update the cache: find session by id, append message, move it to front
        queryClient.setQueryData<ApiResponse<TAllChatSessionsResponse>>(
          cacheKey,
          (old) => {
            if (!old?.data?.sessions?.length) return old;

            const sessionsList = old.data.sessions;
            const index = sessionsList.findIndex((s) => s.id === sessionId);
            if (index === -1) return old;

            const target = sessionsList[index];
            const prevMessages = target.messages ?? [];
            const nextMessages = updateLastMessage
              ? prevMessages.length > 0
                ? [...prevMessages.slice(0, -1), message]
                : [message]
              : [...prevMessages, message];

            const updatedSession = {
              ...target,
              messages: nextMessages,
              projectId: target.projectId ?? projectId,
              updatedAt: paged ? target.updatedAt : new Date(),
            };
            const rest = sessionsList.filter((_, i) => i !== index);
            return {
              ...old,
              data: {
                ...old.data,
                sessions: [updatedSession, ...rest],
              },
            } as ApiResponse<TAllChatSessionsResponse>;
          }
        );

        if (!queryOnly) {
          AI_Chat_API.addMessage(sessionId, message)
            .then((res) => {
              if (paged ? requestedCacheIdentity !== cacheIdentityRef.current : requestedIdentity !== identityRef.current) return;
              const persistedMessage = res.data?.message;
              if (!persistedMessage) return;

              queryClient.setQueryData<ApiResponse<TAllChatSessionsResponse>>(
                cacheKey,
                (old) => {
                  if (!old?.data?.sessions?.length) return old;

                  const sessionsList = old.data.sessions;
                  const index = sessionsList.findIndex((s) => s.id === sessionId);
                  if (index === -1) return old;

                  const target = sessionsList[index];
                  const nextMessages = (target.messages ?? []).map((msg) =>
                    msg.id === message.id ? persistedMessage : msg
                  );

                  const updatedSession = {
                    ...target,
                    messages: nextMessages,
                    updatedAt: paged ? target.updatedAt : new Date(),
                  };

                  const rest = sessionsList.filter((_, i) => i !== index);
                  return {
                    ...old,
                    data: {
                      ...old.data,
                      sessions: [updatedSession, ...rest],
                    },
                  } as ApiResponse<TAllChatSessionsResponse>;
                }
              );
            })
            .catch((error) => {
              console.error("Error persisting chat message:", error);
            });
        }
      } catch (error) {
        console.error("Error adding message to session:", error);
      }
    },
    [hasRequiredData, currentUser?.uid, currentUser?.id, isDemo, queryClient, paged]
  );

  const updateLastMessageInSessionCache = useCallback(
    (sessionId: string, message: IChatMessage) => {
      // queryOnly=true is the persistence boundary: transport-only notices
      // must never reach the add-message API or compete with a durable reply.
      addMessageToSessionQuery(sessionId, message, true, true);
    },
    [addMessageToSessionQuery],
  );

  const appendMessageToSessionCache = useCallback(
    (sessionId: string, message: IChatMessage) => {
      addMessageToSessionQuery(sessionId, message, true, false);
    },
    [addMessageToSessionQuery],
  );

  const updateSessionTitle = useCallback(
    async (sessionId: string, title: string) => {
      if (!hasRequiredData || !currentUser?.uid) {
        console.warn("Cannot update session title: missing user data");
        return;
      }

      const requestedIdentity = identityRef.current;
      const requestedCacheIdentity = cacheIdentityRef.current;
      const trimmed = title.trim();
      if (!trimmed) return;

      try {
        if (isDemo) {
          setDemoSessions((previous) =>
            previous.map((session) =>
              session.id === sessionId
                ? { ...session, title: trimmed, updatedAt: new Date() }
                : session,
            ),
          );
          return;
        }

        queryClient.setQueryData<ApiResponse<TAllChatSessionsResponse>>(
          cacheKey,
          (old) => {
            if (!old?.data?.sessions?.length) return old;

            const sessionsList = old.data.sessions;
            const index = sessionsList.findIndex((s) => s.id === sessionId);
            if (index === -1) return old;

            const target = sessionsList[index];

            if (target.title === trimmed) return old;
            const updatedSession = {
              ...target,
              title: trimmed,
              updatedAt: paged ? target.updatedAt : new Date(),
            };
            const rest = sessionsList.filter((_, i) => i !== index);
            return {
              ...old,
              data: {
                ...old.data,
                sessions: [updatedSession, ...rest],
              },
            } as ApiResponse<TAllChatSessionsResponse>;
          }
        );

        const res = await AI_Chat_API.updateSession(sessionId, trimmed);
        if (paged ? requestedCacheIdentity !== cacheIdentityRef.current : requestedIdentity !== identityRef.current) return;
        if (!res.data?.success) {
          await queryClient.invalidateQueries({
            queryKey: cacheKey,
          });
        }
      } catch (error) {
        if (paged ? requestedCacheIdentity !== cacheIdentityRef.current : requestedIdentity !== identityRef.current) return;
        console.error("Error updating session title:", error);
        await queryClient.invalidateQueries({
          queryKey: cacheKey,
        });
      }
    },
    [hasRequiredData, currentUser?.uid, currentUser?.id, isDemo, queryClient, paged]
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (!hasRequiredData || !currentUser?.uid) {
        console.warn("Cannot delete session: missing user data");
        return;
      }

      const queryKey = cacheKey;
      const requestedIdentity = identityRef.current;
      const requestedCacheIdentity = cacheIdentityRef.current;
      const snapshot = queryClient.getQueryData<
        ApiResponse<TAllChatSessionsResponse>
      >(queryKey);
      const sessionsList = snapshot?.data?.sessions ?? [];
      const onlySessionInCache = sessionsList.length === 1;

      try {
        if (isDemo) {
          const remaining = demoSessions.filter(
            (session) => session.id !== sessionId,
          );
          const nextSessions =
            remaining.length > 0
              ? remaining
              : [createDemoSession(currentUser)];
          setDemoSessions(nextSessions);
          setActiveSession(nextSessions[0].id);
          return;
        }

        await AI_Chat_API.deleteSession(sessionId);
        if (paged ? requestedCacheIdentity !== cacheIdentityRef.current : requestedIdentity !== identityRef.current) return;
        if (onlySessionInCache && !paged) {
          await queryClient.invalidateQueries({ queryKey });
          return;
        }

        const nextSessions = sessionsList.filter((s) => s.id !== sessionId);
        const deletedWasActive =
          activeSession === sessionId || sessionsList[0]?.id === sessionId;

        queryClient.setQueryData<ApiResponse<TAllChatSessionsResponse>>(
          queryKey,
          (old) => {
            if (!old?.data) return old;
            return {
              ...old,
              data: {
                ...old.data,
                success: true,
                sessions: paged ? old.data.sessions.filter((session) => session.id !== sessionId) : nextSessions,
              },
            } as ApiResponse<TAllChatSessionsResponse>;
          }
        );

        if (deletedWasActive) {
          setActiveSession(nextSessions[0]?.id ?? null);
        }
      } catch (error) {
        console.error("Error deleting chat session:", error);
        if (requestedIdentity === identityRef.current) await queryClient.invalidateQueries({ queryKey });
      }
    },
    [
      activeSession,
      currentUser,
      demoSessions,
      hasRequiredData,
      isDemo,
      queryClient, paged,
    ]
  );

  // Initialize session when component mounts or when user/project changes
  useEffect(() => {
    const initializeSession = async () => {
      if (!historyEnabled) return;

      if (!hasRequiredData) {
        // Reset state when required data is missing
        setActiveSession(null);
        setMounted(false);
        return;
      }

      if (isDemo) {
        const session = demoSessions[0] ?? createDemoSession(currentUser);
        if (demoSessions.length === 0) setDemoSessions([session]);
        setActiveSession(session.id);
        setMounted(true);
        return;
      }

      try {
        if (paged) return;
        // Wait for the latestSessionQuery to complete
        if (!legacySessionsReady) return;

        const sessions = sessionsData?.data?.sessions ?? [];

        if (taskId === undefined) {
          // Task-scoped pages will get a real taskId shortly; don't commit
          // another ticket's session in the meantime.
          if (isTaskScoped) return;
          setActiveSession(sessions[0]?.id);
          return;
        }

        // Sessions are reordered to the front on every read/write (see
        // selectSession/addMessageToSessionQuery), so the first match for
        // this task is always its most recently active session.
        const existingTaskSession = sessions.find(
          (session) => session.taskId === taskId
        );
        if (existingTaskSession) {
          setActiveSession(existingTaskSession.id);
          return;
        }

        // No session for this task yet: start a fresh one automatically
        // instead of reusing whatever session another task last used.
        if (startingSessionForTaskRef.current === taskId) return;
        const requestedTaskId = taskId;
        startingSessionForTaskRef.current = requestedTaskId;
        const created = await startNewSession(
          () => currentTaskIdRef.current === requestedTaskId
        );
        // Only clear the guard if nothing has claimed it for a newer ticket
        // since we set it, so a failed/skipped create can retry later
        // without letting a stale response race a fresh in-flight one.
        if (!created && startingSessionForTaskRef.current === requestedTaskId) {
          startingSessionForTaskRef.current = null;
        }
      } catch (error) {
        console.error("Error initializing session:", error);
      }
    };

    initializeSession();
  }, [
    currentUser,
    demoSessions,
    hasRequiredData,
    historyEnabled,
    isDemo,
    legacySessionsReady,
    isTaskScoped,
    sessionsData,
    taskId,
    startNewSession, paged,
  ]);

  const sessions = isDemo ? demoSessions : sessionsData?.data.sessions || [];
  // The single source of truth for "the session the user is looking at".
  // Sessions are reordered to the front on select/write, so `sessions[0]` is
  // usually right, but a session can become active (the per-task init effect
  // above) without being reordered yet - resolve by id so every consumer
  // agrees (HTPR-6100). Only fall back to `sessions[0]` when nothing is
  // active at all; if `activeSession` is set but genuinely missing from
  // `sessions` (deleted, or a transient refetch gap), report no session
  // rather than keep showing a possibly-deleted one indefinitely.
  const currentSession = paged ? pagedHistory.currentSession : activeSession
    ? sessions.find((session) => session.id === activeSession)
    : sessions[0];
  useEffect(() => {
    if (composeEnabled && composeIntro && isTaskScoped &&
        taskId === composeIntro.taskId && currentSession?.taskId === composeIntro.taskId) {
      const id = `compose-task-${composeIntro.taskId}`;
      if (consumedComposeIntro.current !== id && !currentSession.messages.some((message) => message.id === id)) {
        consumedComposeIntro.current = id;
        // An ordinary stored assistant message, not an AI turn: opening a composed
        // ticket must not spend credits or let the model rewrite it a second time.
        (paged ? pagedHistory.addMessageToSessionQuery : addMessageToSessionQuery)(currentSession.id, {
          id, sessionId: currentSession.id, role: "assistant", isDelivered: true,
          createdAt: new Date(), content: composeIntro.content,
        });
      }
      setComposeIntro(null);
    }
  }, [composeEnabled, composeIntro, isTaskScoped, taskId, currentSession, addMessageToSessionQuery, paged, pagedHistory.addMessageToSessionQuery, setComposeIntro]);

  // `currentSession` is `undefined` both when there is genuinely nothing to
  // show yet (no session selected, no sessions exist) and, transiently,
  // when `activeSession` is set but `sessions` hasn't caught up. Consumers
  // decide "show the welcome screen" from this, so tell those two apart
  // here once: a pending selection should keep showing the message area
  // (empty, briefly) rather than flash the welcome screen over it.
  // "Pending" must be bounded to an in-flight fetch, or a session that's
  // genuinely gone (deleted server-side, fetch failed) would blank the
  // message pane forever instead of falling through to the welcome screen.
  // Two different "pending" states, both worth bridging with the message
  // area instead of a welcome-screen flash: the very first load
  // (isLoadingSessions) and an explicit selection still missing from a
  // mid-flight refetch (isFetchingSessions with activeSession set). A bare
  // isFetchingSessions would also cover an empty-sessions user's routine
  // background refetches (window focus, post-delete invalidation), flashing
  // the welcome screen off and back on for no reason. Demo mode never
  // queries the real sessions endpoint, so it's excluded entirely.
  const isSessionPending =
    !isDemo &&
    currentSession === undefined &&
    (isLoadingSessions || (isFetchingSessions && Boolean(activeSession)));
  const showWelcomeScreen = !isSessionPending && (currentSession?.messages?.length ?? 0) === 0;

  const getDisplayedSession = useCallback(() => currentSession, [currentSession]);
  if (paged) return pagedHistory;
  const isSuccessSessions = legacySessionsReady;

  return {
    isLoading: isDemo ? false : isLoadingSessions,
    isError: isDemo ? false : isErrorSessions,
    // Demo initialization is local and effect-driven. Report readiness only
    // after that one path has installed its session, so the send-side readiness
    // guard does not race it by creating a second demo conversation.
    isSuccess: isDemo ? demoSessions.length > 0 : isSuccessSessions,
    activeSession,
    currentSession,
    getDisplayedSession,
    showWelcomeScreen,
    isSessionPending,
    mounted: hasRequiredData ? mounted : false,
    hasRequiredData,
    sessions,
    historySessions: sessions, hasMoreSessions: false, isLoadingMoreSessions: false, pagingError: false,
    loadMoreSessions: async () => {}, resolveHistorySession,
    setActiveSession,
    startNewSession,
    selectSession,
    addMessageToSessionQuery,
    updateLastMessageInSessionCache,
    appendMessageToSessionCache,
    updateSessionTitle,
    deleteSession,
  };
};
