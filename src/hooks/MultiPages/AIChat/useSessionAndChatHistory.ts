import { useFlag } from "@/hooks/useFlag";
import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_7052_CHAT_NAMES_FLAG, HTPR_6971_CHAT_HISTORY_PAGING_FLAG } from "@/lib/flags/keys";
import { currentUserAtom, composeTaskChatIntroAtom, composeTaskSkillFollowupAtom, currentProjectAtom, dockedChatScopeAtom, fullScreenChatScopeAtom } from "@/store";
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
  isTaskScoped = false
) => {
  const pagingRequested = useFlag(HTPR_6971_CHAT_HISTORY_PAGING_FLAG);
  const composeEnabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const chatNames = useFlag(HTPR_7052_CHAT_NAMES_FLAG);
  const [pendingComposeIntro, setComposeIntro] = useRecoilState(composeTaskChatIntroAtom);
  let composeIntro: typeof pendingComposeIntro = null;
  if (composeEnabled) composeIntro = pendingComposeIntro;
  const pendingFollowup = useRecoilValue(composeTaskSkillFollowupAtom);
  const waitingForSkillFollowup = isTaskScoped && Boolean(taskId) && pendingFollowup?.taskId === taskId;
  const hasPendingSkillIntro = isTaskScoped && composeIntro?.skillFollowup && composeIntro.taskId === taskId;
  const consumedComposeIntro = useRef<string | null>(null);
  const currentUser = useRecoilValue(currentUserAtom);
  const pathname = usePathname();
  const isDemo = pathname?.startsWith("/demo") ?? false;
  const currentProject = useRecoilValue(currentProjectAtom);
  const dockedScope = useRecoilValue(dockedChatScopeAtom);
  const fullScreenScope = useRecoilValue(fullScreenChatScopeAtom);
  const nameBoardRef = useRef<number | undefined>(undefined);
  let scopedBoardId: number | undefined = fullScreenScope ?? undefined;
  if (!(pathname?.startsWith("/chat") ?? false)) {
    if (dockedScope === null || dockedScope === "ticket") scopedBoardId = currentProject?.id;
    else scopedBoardId = dockedScope === "all" ? undefined : dockedScope;
  }
  if (chatNames) nameBoardRef.current = scopedBoardId;
  else nameBoardRef.current = undefined;
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [demoSessions, setDemoSessions] = useState<IChatSession[]>([]);
  const queryClient = useQueryClient();
  const startingSessionForTaskRef = useRef<number | null>(null);
  const currentTaskIdRef = useRef<number | undefined>(taskId);
  currentTaskIdRef.current = taskId;

  const hasRequiredData = !!currentUser?.uid;
  const pagedHistory = usePagedChatHistory(pagingRequested && !isDemo, currentUser, taskId, historyEnabled, isTaskScoped, nameBoardRef);
  const paged = pagingRequested && !isDemo && !pagedHistory.pagingUnavailable;

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
    enabled: historyEnabled && hasRequiredData && !isDemo && !paged,
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
      const session = createDemoSession(currentUser);
      setDemoSessions((previous) => [session, ...previous]);
      setActiveSession(session.id);
      setMounted(true);
      return session;
    }

    try {
      const res = await AI_Chat_API.createSessionNext(taskId, nameBoardRef.current);
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

  useEffect(() => {
    const initializeSession = async () => {
      if (!historyEnabled) return;

      if (!hasRequiredData) {
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
        if (!isSuccessSessions) return;

        const sessions = sessionsData?.data?.sessions ?? [];

        if (taskId === undefined) {
          if (isTaskScoped) return;
          setActiveSession(sessions[0]?.id);
          return;
        }

        const existingTaskSession = sessions.find(
          (session) => session.taskId === taskId
        );
        if (existingTaskSession) {
          setActiveSession(existingTaskSession.id);
          return;
        }

        if (startingSessionForTaskRef.current === taskId) return;
        const requestedTaskId = taskId;
        startingSessionForTaskRef.current = requestedTaskId;
        const created = await startNewSession(
          () => currentTaskIdRef.current === requestedTaskId
        );
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
    startNewSession, paged,
  ]);

  const sessions = isDemo ? demoSessions : sessionsData?.data.sessions || [];
  const currentSession = paged ? pagedHistory.currentSession : activeSession
    ? sessions.find((session) => session.id === activeSession)
    : sessions[0];
  useEffect(() => {
    if (!waitingForSkillFollowup && composeEnabled && composeIntro && isTaskScoped &&
        taskId === composeIntro.taskId && currentSession?.taskId === composeIntro.taskId) {
      const id = `compose-task-${composeIntro.taskId}`;
      if (consumedComposeIntro.current !== id && !currentSession.messages.some((message) => message.id === id)) {
        consumedComposeIntro.current = id;
        (paged ? pagedHistory.addMessageToSessionQuery : addMessageToSessionQuery)(currentSession.id, {
          id, sessionId: currentSession.id, role: "assistant", isDelivered: true,
          createdAt: new Date(), content: composeIntro.content,
        });
      }
      setComposeIntro(null);
    }
  }, [waitingForSkillFollowup, composeEnabled, composeIntro, isTaskScoped, taskId, currentSession, addMessageToSessionQuery, setComposeIntro, paged, pagedHistory.addMessageToSessionQuery]);

  const isSessionPending =
    !isDemo &&
    currentSession === undefined &&
    (isLoadingSessions || (isFetchingSessions && Boolean(activeSession)));
  const showWelcomeScreen = !waitingForSkillFollowup && !hasPendingSkillIntro && !isSessionPending && (currentSession?.messages?.length ?? 0) === 0;

  const getDisplayedSession = useCallback(() => currentSession, [currentSession]);
  const resolveHistorySession = useCallback(async (sessionId?: string, scope?: ChatSessionScope) => sessions.find((session) =>
    sessionId ? session.id === sessionId :
      (!scope?.taskId || session.taskId === scope.taskId) &&
      (!scope?.projectId || (session.projectId === scope.projectId && session.taskId === null))), [sessions]);
  if (paged) return { ...pagedHistory, showWelcomeScreen: pagedHistory.showWelcomeScreen && !waitingForSkillFollowup && !hasPendingSkillIntro, sessionPagingEnabled: true };

  return {
    sessionPagingEnabled: false,
    historySessions: sessions, hasMoreSessions: false, isLoadingMoreSessions: false, pagingError: false,
    loadMoreSessions: async () => {}, refreshHistorySessions: async () => {}, resolveHistorySession, getDisplayedSession,
    isLoading: isDemo ? false : isLoadingSessions,
    isError: isDemo ? false : isErrorSessions,
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
