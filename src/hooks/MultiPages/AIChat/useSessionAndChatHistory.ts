import { HTPR_7736_CHAT_FOLLOWS_TASK_FLAG } from "@/lib/flags/definitions/htpr-7736-chat-follows-task";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_7052_CHAT_NAMES_FLAG, HTPR_6971_CHAT_HISTORY_PAGING_FLAG, HTPR_7319_SKILL_CHAT_FOLLOWUP_FLAG, HTPR_7783_REMEMBER_CHAT_FLAG, HTPR_7794_STOP_CLOSES_STREAM_FLAG } from "@/lib/flags/keys";
import { currentUserAtom, composeTaskChatIntroAtom, composeTaskSkillFollowupAtom, currentProjectAtom, fullScreenChatScopeAtom } from "@/store";
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
import { useDockedChatScope } from "./useDockedChatScope";
import { chatNavigationKey } from "@/lib/aiChat/chatNavigationState";
import { useChatSessionSelection } from "./useChatSessionSelection";

const createDemoSession = (user: IUser): IChatSession => {
  const now = new Date();
  return {
    id: `demo-chat-${crypto.randomUUID()}`,
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
  isTaskScoped = false,
  preserveSessionSelection = false,
  manualChat = false,
  teamKey?: string | null
) => {
  const rememberChat = useFlag(HTPR_7783_REMEMBER_CHAT_FLAG);
  const stopClosesStream = useFlag(HTPR_7794_STOP_CLOSES_STREAM_FLAG);
  const pagingRequested = useFlag(HTPR_6971_CHAT_HISTORY_PAGING_FLAG);
  const composeEnabled = useFlag(HTPR_6929_COMPOSE_TASK_WRITER_FLAG);
  const chatNames = useFlag(HTPR_7052_CHAT_NAMES_FLAG);
  const [pendingComposeIntro, setComposeIntro] = useRecoilState(composeTaskChatIntroAtom);
  let composeIntro: typeof pendingComposeIntro = null;
  if (composeEnabled) composeIntro = pendingComposeIntro;
  const skillFollowupEnabled = useFlag(HTPR_7319_SKILL_CHAT_FOLLOWUP_FLAG);
  const pendingFollowupState = useRecoilValue(composeTaskSkillFollowupAtom);
  let pendingFollowup: typeof pendingFollowupState = null;
  if (skillFollowupEnabled) pendingFollowup = pendingFollowupState;
  const waitingForSkillFollowup = isTaskScoped && Boolean(taskId) && pendingFollowup?.taskId === taskId;
  const hasPendingSkillIntro = isTaskScoped && composeIntro?.skillFollowup && composeIntro.taskId === taskId;
  const consumedComposeIntro = useRef<string | null>(null);
  const currentUser = useRecoilValue(currentUserAtom);
  const pathname = usePathname();
  const isDemo = pathname?.startsWith("/demo") ?? false;
  const taskNavigationEnabled = useFlag(HTPR_7736_CHAT_FOLLOWS_TASK_FLAG);
  let followsTaskNavigation = false;
  if (taskNavigationEnabled && isTaskScoped && !pathname?.startsWith("/chat")) followsTaskNavigation = true;
  const explicitTaskRef = useRef<{ taskId: number | undefined; generation: number }>({ taskId: undefined, generation: 0 });
  const hasExplicitTask = taskId !== undefined && (composeIntro?.taskId === taskId || pendingFollowup?.taskId === taskId);
  if (hasExplicitTask && explicitTaskRef.current.taskId !== taskId) explicitTaskRef.current.generation += 1;
  explicitTaskRef.current.taskId = hasExplicitTask ? taskId : undefined;
  const selectionScope = manualChat ? `manual:${teamKey ?? "none"}` : followsTaskNavigation ? `following:${explicitTaskRef.current.generation}` : taskId;
  const taskScopedHistory = isTaskScoped && !manualChat;
  const currentProject = useRecoilValue(currentProjectAtom);
  const [dockedScope] = useDockedChatScope();
  const fullScreenScope = useRecoilValue(fullScreenChatScopeAtom);
  const nameBoardRef = useRef<number | undefined>(undefined);
  let scopedBoardId: number | undefined = fullScreenScope ?? undefined;
  if (!(pathname?.startsWith("/chat") ?? false)) {
    if (dockedScope === null || dockedScope === "ticket") scopedBoardId = currentProject?.id;
    else scopedBoardId = dockedScope === "all" ? undefined : dockedScope;
  }
  if (chatNames) nameBoardRef.current = scopedBoardId;
  else nameBoardRef.current = undefined;
  const navigationScope = chatNavigationKey(currentUser?.id, manualChat ? undefined : scopedBoardId, taskId, pathname?.startsWith("/chat"));
  const navigationKey = rememberChat && !isDemo && navigationScope ? `${navigationScope}${manualChat ? `.team.${teamKey ?? "none"}` : ""}` : null;
  const [activeSession, setActiveSession] = useChatSessionSelection(navigationKey ?? "legacy", navigationKey);
  useEffect(() => {
    if (manualChat && !navigationKey) setActiveSession(null);
  }, [manualChat, teamKey, navigationKey, setActiveSession]);
  const [mounted, setMounted] = useState(false);
  const [demoSessions, setDemoSessions] = useState<IChatSession[]>([]);
  const queryClient = useQueryClient();
  const startingSessionForTaskRef = useRef<number | null>(null);
  const currentTaskIdRef = useRef<number | undefined>(taskId);
  currentTaskIdRef.current = taskId;

  const hasRequiredData = !!currentUser?.uid;
  const pagedHistory = usePagedChatHistory(pagingRequested && !isDemo, currentUser, taskId, historyEnabled, taskScopedHistory, nameBoardRef, { key: selectionScope, initialTaskId: followsTaskNavigation && !hasExplicitTask ? undefined : taskId }, navigationKey, scopedBoardId);
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
  }, [hasRequiredData, currentUser?.uid, isDemo, queryClient, taskId, setActiveSession]);

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
    [hasRequiredData, currentUser?.uid, isDemo, queryClient, setActiveSession]
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
              const messageIndex = stopClosesStream && updateLastMessage
                ? previousMessages.findIndex((previous) => previous.id === message.id)
                : -1;
              const messages = [...previousMessages];
              if (messageIndex >= 0) messages[messageIndex] = message;
              else if (updateLastMessage && messages.length > 0) messages[messages.length - 1] = message;
              else messages.push(message);
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
            const messageIndex = stopClosesStream && updateLastMessage
              ? prevMessages.findIndex((previous) => previous.id === message.id)
              : -1;
            const nextMessages = [...prevMessages];
            if (messageIndex >= 0) nextMessages[messageIndex] = message;
            else if (updateLastMessage && nextMessages.length > 0) nextMessages[nextMessages.length - 1] = message;
            else nextMessages.push(message);

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
    [hasRequiredData, currentUser?.uid, isDemo, queryClient, stopClosesStream]
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
        return false;
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
          return true;
        }

        await AI_Chat_API.deleteSession(sessionId);

        if (onlySessionInCache) {
          await queryClient.invalidateQueries({ queryKey });
          return true;
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
        return true;
      } catch (error) {
        console.error("Error deleting chat session:", error);
        await queryClient.invalidateQueries({ queryKey });
        return false;
      }
    },
    [
      activeSession,
      currentUser,
      demoSessions,
      hasRequiredData,
      isDemo,
      queryClient,
      setActiveSession,
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

        if (followsTaskNavigation && !hasExplicitTask && sessions.length > 0) {
          setActiveSession((selected) => sessions.some((session) => session.id === selected && session.userId === currentUser.id) ? selected : sessions[0]?.id);
          return;
        }

        if (taskId === undefined) {
          if (taskScopedHistory) return;
          if (navigationKey && sessions.some((session) => session.id === activeSession)) return;
          const availableSessions = navigationKey
            ? sessions.filter((session) => !session.agentId && (scopedBoardId === undefined || (session.projectId === scopedBoardId && session.taskId === null)))
            : sessions;
          if (preserveSessionSelection) {
            setActiveSession(availableSessions.some((session) => session.id === activeSession) ? activeSession : availableSessions[0]?.id ?? null);
          } else setActiveSession(availableSessions[0]?.id ?? null);
          return;
        }

        if (navigationKey && sessions.some((session) => session.id === activeSession)) return;
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
    taskScopedHistory,
    sessionsData,
    taskId,
    startNewSession, paged, preserveSessionSelection, followsTaskNavigation, hasExplicitTask, activeSession, navigationKey, setActiveSession, scopedBoardId,
  ]);

  const sessions = isDemo ? demoSessions : sessionsData?.data.sessions || [];
  const selectedSession = paged ? pagedHistory.currentSession : activeSession
    ? sessions.find((session) => session.id === activeSession)
    : navigationKey ? undefined : sessions[0];
  const currentSession = followsTaskNavigation && hasExplicitTask && selectedSession?.taskId !== taskId ? undefined : selectedSession;
  useEffect(() => {
    if (!waitingForSkillFollowup && composeEnabled && composeIntro && currentSession &&
        (manualChat || (isTaskScoped && taskId === composeIntro.taskId && currentSession.taskId === composeIntro.taskId))) {
      const id = `compose-task-${composeIntro.taskId}`;
      if (consumedComposeIntro.current !== id && !currentSession.messages.some((message) => message.id === id)) {
        const greeting: IChatMessage = {
          id, sessionId: currentSession.id, role: "assistant", isDelivered: true,
          createdAt: new Date(), content: composeIntro.content,
        };
        if (paged) {
          if (!pagedHistory.addMessageToSessionQuery(currentSession.id, greeting)) return;
        } else {
          addMessageToSessionQuery(currentSession.id, greeting);
        }
        consumedComposeIntro.current = id;
      }
      setComposeIntro(null);
    }
  }, [waitingForSkillFollowup, composeEnabled, composeIntro, isTaskScoped, manualChat, taskId, currentSession, addMessageToSessionQuery, setComposeIntro, paged, pagedHistory.addMessageToSessionQuery]);

  const isSessionPending =
    !isDemo &&
    currentSession === undefined &&
    (isLoadingSessions || (isFetchingSessions && Boolean(activeSession)));
  const showWelcomeScreen = !waitingForSkillFollowup && !hasPendingSkillIntro && !isSessionPending && (currentSession?.messages?.length ?? 0) === 0;

  const getDisplayedSession = useCallback(() => currentSession, [currentSession]);
  const resolveHistorySession = useCallback(async (sessionId?: string, scope?: ChatSessionScope) => sessions.find((session) =>
    sessionId ? session.id === sessionId :
      !session.agentId && (!scope?.taskId || session.taskId === scope.taskId) &&
      (!scope?.projectId || (session.projectId === scope.projectId && session.taskId === null))), [sessions]);
  if (paged) return { ...pagedHistory, navigationKey, showWelcomeScreen: pagedHistory.showWelcomeScreen && !waitingForSkillFollowup && !hasPendingSkillIntro, sessionPagingEnabled: true };

  return {
    navigationKey,
    sessionPagingEnabled: false,
    historySessions: sessions, hasMoreSessions: false, isLoadingMoreSessions: false, pagingError: false,
    loadMoreSessions: async () => {}, refreshHistorySessions: async () => {}, resolveHistorySession, getDisplayedSession,
    isLoading: isDemo ? false : isLoadingSessions,
    isError: isDemo ? false : isErrorSessions,
    isSuccess: isDemo ? demoSessions.length > 0 : isSuccessSessions,
    isHistoryReady: isDemo ? demoSessions.length > 0 : isSuccessSessions,
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
