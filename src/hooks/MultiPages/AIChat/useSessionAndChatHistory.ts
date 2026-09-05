import { currentUserAtom } from "@/store";
import type { ApiResponse } from "@/utils/axiosClient";
import {
  AI_Chat_API,
  type TAllChatSessionsResponse,
} from "@/utils/api/ai_chat";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRecoilValue } from "@/lib/state";
import { IChatMessage, IChatSession, IUser } from "@/models/model";
import { usePathname } from "next/navigation";

const createDemoSession = (user: IUser): IChatSession => {
  const now = new Date();
  return {
    id: `demo-chat-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
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

  // ChatProvider stays mounted so global shortcuts keep working, but the
  // session payload is secondary startup data. Do not request it until the
  // chat is visible (or the user has otherwise expressed chat intent).
  const {
    data: sessionsData,
    isLoading: isLoadingSessions,
    isFetching: isFetchingSessions,
    isError: isErrorSessions,
    isSuccess: isSuccessSessions,
  } = useQuery({
    queryKey: ["chat-sessions", currentUser?.uid],
    queryFn: () => {
      if (!currentUser?.uid) {
        throw new Error("Missing required user data");
      }
      return AI_Chat_API.getAllSessions();
    },
    enabled: historyEnabled && hasRequiredData && !isDemo,
    staleTime: 1000 * 60 * 3,
  });

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

    try {
      const res = await AI_Chat_API.createSessionNext(taskId);
      const body = res.data;

      if (!body?.success || !body.session?.id) {
        console.warn("Invalid create session response from API");
        return;
      }

      const newSession = body.session;
      const newSessionId = newSession.id;
      if (!shouldCommit()) return;

      queryClient.setQueryData<ApiResponse<TAllChatSessionsResponse>>(
        ["chat-sessions", currentUser?.uid],
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
  }, [hasRequiredData, currentUser?.uid, isDemo, queryClient, taskId]);

  const selectSession = useCallback(
    (sessionId: string) => {
      if (!hasRequiredData || !currentUser?.uid) {
        console.warn("Cannot select session: missing user data");
        return;
      }

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
          ["chat-sessions", currentUser.uid],
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
        console.error("Error selecting session:", error);
      }
    },
    [hasRequiredData, currentUser?.uid, isDemo, queryClient]
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
          ["chat-sessions", currentUser.uid],
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
              updatedAt: new Date(),
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
              const persistedMessage = res.data?.message;
              if (!persistedMessage) return;

              queryClient.setQueryData<ApiResponse<TAllChatSessionsResponse>>(
                ["chat-sessions", currentUser.uid],
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
                    updatedAt: new Date(),
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
    [hasRequiredData, currentUser?.uid, isDemo, queryClient]
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
          ["chat-sessions", currentUser.uid],
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
              updatedAt: new Date(),
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
        if (!res.data?.success) {
          await queryClient.invalidateQueries({
            queryKey: ["chat-sessions", currentUser.uid],
          });
        }
      } catch (error) {
        console.error("Error updating session title:", error);
        await queryClient.invalidateQueries({
          queryKey: ["chat-sessions", currentUser.uid],
        });
      }
    },
    [hasRequiredData, currentUser?.uid, isDemo, queryClient]
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (!hasRequiredData || !currentUser?.uid) {
        console.warn("Cannot delete session: missing user data");
        return;
      }

      const queryKey = ["chat-sessions", currentUser.uid] as const;
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

        if (onlySessionInCache) {
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
                sessions: nextSessions,
              },
            } as ApiResponse<TAllChatSessionsResponse>;
          }
        );

        if (deletedWasActive) {
          setActiveSession(nextSessions[0]?.id ?? null);
        }
      } catch (error) {
        console.error("Error deleting chat session:", error);
        await queryClient.invalidateQueries({ queryKey });
      }
    },
    [
      activeSession,
      currentUser,
      demoSessions,
      hasRequiredData,
      isDemo,
      queryClient,
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
        // Wait for the latestSessionQuery to complete
        if (!isSuccessSessions) return;

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
    isSuccessSessions,
    isTaskScoped,
    sessionsData,
    taskId,
    startNewSession,
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
  const currentSession = activeSession
    ? sessions.find((session) => session.id === activeSession)
    : sessions[0];
  // `currentSession` is `undefined` both when there is genuinely nothing to
  // show yet (no session selected, no sessions exist) and, transiently,
  // when `activeSession` is set but `sessions` hasn't caught up. Consumers
  // decide "show the welcome screen" from this, so tell those two apart
  // here once: a pending selection should keep showing the message area
  // (empty, briefly) rather than flash the welcome screen over it.
  // "Pending" must be bounded to an in-flight fetch, or a session that's
  // genuinely gone (deleted server-side, fetch failed) would blank the
  // message pane forever instead of falling through to the welcome screen.
  const isSessionPending =
    isFetchingSessions && activeSession !== undefined && currentSession === undefined;
  const showWelcomeScreen = !isSessionPending && (currentSession?.messages.length ?? 0) === 0;

  return {
    isLoading: isDemo ? false : isLoadingSessions,
    isError: isDemo ? false : isErrorSessions,
    // Demo initialization is local and effect-driven. Report readiness only
    // after that one path has installed its session, so the send-side readiness
    // guard does not race it by creating a second demo conversation.
    isSuccess: isDemo ? demoSessions.length > 0 : isSuccessSessions,
    activeSession,
    currentSession,
    showWelcomeScreen,
    isSessionPending,
    mounted: hasRequiredData ? mounted : false,
    hasRequiredData,
    sessions,
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
