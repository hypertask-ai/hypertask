import { useFlag } from "@/hooks/useFlag";
import { HTPR_6929_COMPOSE_TASK_WRITER_FLAG, HTPR_6924_REST_COMPAT_FLAG } from "@/lib/flags/keys";
import { currentUserAtom, composeTaskChatIntroAtom } from "@/store";
import type { ApiResponse } from "@/utils/axiosClient";
import {
  AI_Chat_API,
  type TAllChatSessionsResponse,
  type TChatSessionsWireResponse,
  type ChatSessionScope,
  type ChatSessionSummary,
  isPagedChatSessions, mergeSessionHistory, mergeSessionTranscript,
} from "@/utils/api/ai_chat";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { IChatMessage, IChatSession, IUser } from "@/models/model";
import { usePathname } from "next/navigation";

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
  const activeSessionRef = useRef(activeSession);
  activeSessionRef.current = activeSession;
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
  const cacheKey = paged
    ? ["chat-session-transcripts", currentUser?.uid, currentUser?.id, HTPR_6924_REST_COMPAT_FLAG, "loaded"]
    : ["chat-sessions", currentUser?.uid];
  const summaryKey = ["chat-session-summaries", currentUser?.uid, currentUser?.id, HTPR_6924_REST_COMPAT_FLAG, "history"];
  const cacheIdentity = `${currentUser?.uid}:${currentUser?.id}:${paged}`;
  const cacheIdentityRef = useRef(cacheIdentity);
  cacheIdentityRef.current = cacheIdentity;
  const identity = `${cacheIdentity}:${taskId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const selectionRef = useRef(0);
  const initializationRef = useRef<string | null>(null);
  const transcriptVersionsRef = useRef(new Map<string, number>());
  const pendingMessagesRef = useRef(new Map<string, Map<string, IChatMessage>>());
  const pendingTitlesRef = useRef(new Map<string, string>());
  const [transcriptPending, setTranscriptPending] = useState(false);
  const [transcriptError, setTranscriptError] = useState(false);
  const [isLoadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const [pagingError, setPagingError] = useState(false);
  const loadingMoreRef = useRef(false);
  const historyVersionRef = useRef(0);
  const previousIdentityRef = useRef(identity);
  useEffect(() => {
    if (previousIdentityRef.current === identity) return;
    previousIdentityRef.current = identity;
    setActiveSession(null);
    setMounted(false);
    setTranscriptPending(false);
    setTranscriptError(false);
    setLoadingMoreSessions(false);
    loadingMoreRef.current = false;
    startingSessionForTaskRef.current = null;
    initializationRef.current = null;
    selectionRef.current += 1;
  }, [identity]);
  useEffect(() => {
    return () => {
      if (!paged) return;
      transcriptVersionsRef.current.clear();
      pendingMessagesRef.current.clear();
      pendingTitlesRef.current.clear();
      for (const queryKey of [summaryKey, ["chat-session-transcripts", currentUser?.uid, currentUser?.id, HTPR_6924_REST_COMPAT_FLAG]]) {
        void queryClient.cancelQueries({ queryKey });
        queryClient.removeQueries({ queryKey });
      }
    };
  }, [currentUser?.uid, currentUser?.id, paged]);

  const summaryQuery = useQuery({
    queryKey: summaryKey,
    queryFn: async ({ signal }) => {
      const before = queryClient.getQueryData<ApiResponse<TChatSessionsWireResponse>>(summaryKey);
      const response = await AI_Chat_API.getSessionPage({}, signal);
      if (!response.data.success) throw new Error("Could not load chat history");
      if (signal.aborted) return response;
      historyVersionRef.current += 1;
      const previous = queryClient.getQueryData<ApiResponse<TChatSessionsWireResponse>>(summaryKey);
      if (isPagedChatSessions(response.data) && previous && isPagedChatSessions(previous.data)) {
        const refreshed = response.data;
        const last = refreshed.sessions.at(-1);
        const retained = previous.data.sessions.filter((session) =>
          !before?.data.sessions.some((row) => row.id === session.id) ||
          refreshed.sessions.some((row) => row.id === session.id) ||
          pendingMessagesRef.current.get(session.id)?.size || pendingTitlesRef.current.has(session.id) ||
          (refreshed.nextCursor && last && (
            new Date(session.updatedAt).getTime() < new Date(last.updatedAt).getTime() ||
            (new Date(session.updatedAt).getTime() === new Date(last.updatedAt).getTime() && session.id < last.id)
          )));
        const removed = new Set(previous.data.sessions.filter((session) => !retained.includes(session)).map((session) => session.id));
        queryClient.setQueryData<ApiResponse<TAllChatSessionsResponse>>(cacheKey, (old) => old ? {
          ...old, data: { ...old.data, sessions: old.data.sessions.filter((session) => !removed.has(session.id)) },
        } : old);
        if (activeSessionRef.current && removed.has(activeSessionRef.current)) {
          // The selected conversation was deleted: navigate to a surviving session.
          selectionRef.current += 1;
          initializationRef.current = null;
          startingSessionForTaskRef.current = null;
          setActiveSession(null);
          setTranscriptError(false);
        }
        response.data.sessions = mergeSessionHistory(refreshed.sessions, retained);
      }
      return response;
    },
    enabled: historyEnabled && hasRequiredData && paged,
    staleTime: 1000 * 60 * 3,
  });

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


  const resolveHistorySession = useCallback(async (sessionId?: string, scope?: ChatSessionScope, emptyOnly = false) => {
    const requestedIdentity = identityRef.current;
    const requestedSelection = selectionRef.current;
    if (!paged) return sessionsData?.data.sessions.find((session) =>
      sessionId ? session.id === sessionId :
        (!scope?.taskId || session.taskId === scope.taskId) &&
        (!scope?.projectId || session.projectId === scope.projectId));
    let id = sessionId;
    let summary = summaryQuery.data?.data.sessions.find((session) => session.id === id);
    if (emptyOnly) {
      const body = summaryQuery.data?.data;
      if (!body) return;
      id = isPagedChatSessions(body)
        ? body.sessions.find((session) => !session.hasMessages)?.id
        : body.sessions.find((session) => session.messages.length === 0)?.id;
      if (!id) return;
    }
    if (!id) {
      const page = await queryClient.fetchQuery({
        queryKey: [...summaryKey, "scope", scope?.taskId ?? null, scope?.projectId ?? null],
        queryFn: ({ signal }) => AI_Chat_API.getSessionPage({ ...scope, limit: 1 }, signal),
        staleTime: 0,
      });
      if (!page.data.success) throw new Error("Could not resolve chat session");
      // The server may answer the full legacy list after a flag rollback.
      summary = page.data.sessions.find((session) =>
        (!scope?.taskId || session.taskId === scope.taskId) &&
        (!scope?.projectId || session.projectId === scope.projectId));
      id = summary?.id;
    }
    if (!id || requestedIdentity !== identityRef.current || requestedSelection !== selectionRef.current) return;
    const existing = queryClient.getQueryData<ApiResponse<TAllChatSessionsResponse>>(cacheKey)
      ?.data.sessions.find((session) => session.id === id);
    summary ??= summaryQuery.data?.data.sessions.find((session) => session.id === id);
    const version = transcriptVersionsRef.current.get(id) ?? (existing ? new Date(existing.updatedAt).getTime() : 0);
    if (existing && (!summary || new Date(summary.updatedAt).getTime() <= version)) {
      queryClient.setQueryData<ApiResponse<TAllChatSessionsResponse>>(cacheKey, (old) => old ? {
        ...old,
        data: { ...old.data, sessions: [existing, ...old.data.sessions.filter((session) => session.id !== id)] },
      } : old);
      return existing;
    }
    const pendingAtFetch = new Set(pendingMessagesRef.current.get(id)?.keys());
    let incoming: IChatSession | null;
    try {
      incoming = await queryClient.fetchQuery({
        queryKey: ["chat-session-transcripts", currentUser?.uid, currentUser?.id, HTPR_6924_REST_COMPAT_FLAG, id],
        queryFn: ({ signal }) => AI_Chat_API.getSessionTranscript(id!, signal),
        staleTime: 0,
      });
    } catch (error) {
      if ((error as { response?: { status?: number } }).response?.status === 404) return;
      throw error;
    }
    if (!incoming || requestedIdentity !== identityRef.current || requestedSelection !== selectionRef.current || incoming.userId !== currentUser?.id) return;
    transcriptVersionsRef.current.set(id, new Date(incoming.updatedAt).getTime());
    let resolved = incoming;
    queryClient.setQueryData<ApiResponse<TAllChatSessionsResponse>>(cacheKey, (old) => {
      const pending = pendingMessagesRef.current.get(id!);
      for (const message of incoming!.messages) {
        const local = pending?.get(message.id);
        if (local?.content === message.content && local.isDelivered !== false) pending?.delete(message.id);
      }
      const local = old?.data.sessions.find((session) => session.id === id);
      const pendingIds = new Set(pending?.keys());
      // A snapshot taken before an acknowledgement must not erase that completed write.
      for (const message of local?.messages ?? []) {
        const before = existing?.messages.find((row) => row.id === message.id);
        if (message !== before || (pendingAtFetch.has(message.id) && !incoming!.messages.some((row) => row.id === message.id))) pendingIds.add(message.id);
      }
      resolved = mergeSessionTranscript(incoming!, local, pendingIds);
      const title = pendingTitlesRef.current.get(id!) ?? (local && local.title !== existing?.title ? local.title : undefined);
      if (title !== undefined) resolved = { ...resolved, title };
      return { ...old, data: { success: true, sessions: [resolved, ...(old?.data.sessions ?? []).filter((session) => session.id !== id)] } } as ApiResponse<TAllChatSessionsResponse>;
    });
    return resolved;
  }, [paged, currentUser?.uid, currentUser?.id, queryClient, sessionsData, taskId, summaryQuery.data]);

  const loadMoreSessions = useCallback(async () => {
    const body = summaryQuery.data?.data;
    if (!paged || !body || !isPagedChatSessions(body) || !body.nextCursor || loadingMoreRef.current) return;
    const requestedIdentity = identityRef.current;
    const requestedHistoryVersion = historyVersionRef.current;
    loadingMoreRef.current = true;
    setLoadingMoreSessions(true);
    setPagingError(false);
    try {
      const page = await queryClient.fetchQuery({
        queryKey: [...summaryKey, "page", body.nextCursor],
        queryFn: ({ signal }) => AI_Chat_API.getSessionPage({ cursor: body.nextCursor! }, signal),
        staleTime: 0,
      });
      if (!page.data.success) throw new Error("Could not load chat history");
      if (requestedIdentity !== identityRef.current || requestedHistoryVersion !== historyVersionRef.current) return;
      queryClient.setQueryData<ApiResponse<TChatSessionsWireResponse>>(summaryKey, (old) => ({
        ...page, data: isPagedChatSessions(page.data)
          ? { ...page.data, sessions: mergeSessionHistory(page.data.sessions, old?.data.sessions as ChatSessionSummary[] ?? []) }
          : page.data,
      }));
    } catch {
      if (requestedIdentity === identityRef.current) setPagingError(true);
    } finally {
      if (requestedIdentity === identityRef.current) {
        loadingMoreRef.current = false;
        setLoadingMoreSessions(false);
      }
    }
  }, [paged, summaryQuery.data, queryClient, taskId]);

  useEffect(() => {
    if (!paged) return;
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || JSON.stringify(event.query.queryKey) !== JSON.stringify(cacheKey)) return;
      const loaded = queryClient.getQueryData<ApiResponse<TAllChatSessionsResponse>>(cacheKey)?.data.sessions ?? [];
      queryClient.setQueryData<ApiResponse<TChatSessionsWireResponse>>(summaryKey, (old) => {
        if (!old || !isPagedChatSessions(old.data)) return old;
        const body = old.data;
        const metadata = loaded.map(({ messages, ...session }) => {
          const previous = body.sessions.find((row) => row.id === session.id);
          const scalars = session as typeof session & { agentId?: string | null; teamId?: string | null };
          return { ...session, agentId: scalars.agentId ?? previous?.agentId ?? null, teamId: scalars.teamId ?? previous?.teamId ?? null, hasMessages: messages.length > 0 };
        });
        return { ...old, data: { ...old.data, sessions: mergeSessionHistory<ChatSessionSummary>(metadata, body.sessions) } };
      });
    });
  }, [paged, currentUser?.uid, currentUser?.id, queryClient]);

  const startNewSession = useCallback(async (
    shouldCommit: () => boolean = () => true,
    initializing = false
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
    if (paged && !initializing) selectionRef.current += 1;
    const requestedSelection = selectionRef.current;
    if (paged) setTranscriptPending(true);
    try {
      const res = await AI_Chat_API.createSessionNext(taskId);
      const body = res.data;

      if (!body?.success || !body.session?.id) {
        console.warn("Invalid create session response from API");
        return;
      }

      const newSession = body.session;
      const newSessionId = newSession.id;
      if (!shouldCommit() || requestedIdentity !== identityRef.current || (paged && requestedSelection !== selectionRef.current)) return;
      if (paged) transcriptVersionsRef.current.set(newSessionId, new Date(newSession.updatedAt).getTime());

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
      if (paged) {
        setTranscriptError(false);
        setTranscriptPending(false);
      }
      setMounted(true);
      return newSession;
    } catch (error) {
      console.log("🚀 ~ useSessionAndChatHistory ~ error:", error);
    } finally {
      if (paged && requestedIdentity === identityRef.current && requestedSelection === selectionRef.current) setTranscriptPending(false);
    }
  }, [hasRequiredData, currentUser?.uid, currentUser?.id, isDemo, queryClient, taskId, paged]);

  const selectSession = useCallback(
    async (sessionId: string) => {
      if (!hasRequiredData || !currentUser?.uid) {
        console.warn("Cannot select session: missing user data");
        return;
      }

      const selection = ++selectionRef.current;
      const requestedIdentity = identityRef.current;
      try {
        if (paged) {
          setActiveSession(sessionId);
          setTranscriptPending(true);
          setTranscriptError(false);
          const selected = await resolveHistorySession(sessionId);
          if (selection !== selectionRef.current || requestedIdentity !== identityRef.current) return;
          if (!selected) setTranscriptError(true);
          setTranscriptPending(false);
          setMounted(Boolean(selected));
          return;
        }
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
        if (selection === selectionRef.current && requestedIdentity === identityRef.current) {
          setTranscriptPending(false);
          setTranscriptError(true);
        }
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

        if (paged) {
          const pending = pendingMessagesRef.current.get(sessionId) ?? new Map<string, IChatMessage>();
          if (queryOnly && message.isDelivered === true) pending.delete(message.id);
          else pending.set(message.id, message);
          pendingMessagesRef.current.set(sessionId, pending);
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
              if (paged) {
                const pending = pendingMessagesRef.current.get(sessionId);
                if (pending?.get(message.id) !== message) return;
                pending.delete(message.id);
              }

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
      const previousTitle = queryClient.getQueryData<ApiResponse<TAllChatSessionsResponse>>(cacheKey)?.data.sessions.find((session) => session.id === sessionId)?.title;
      const restoreTitle = () => {
        if (!paged || requestedCacheIdentity !== cacheIdentityRef.current) return;
        queryClient.setQueryData<ApiResponse<TAllChatSessionsResponse>>(cacheKey, (old) => old ? {
          ...old, data: { ...old.data, sessions: old.data.sessions.map((session) => session.id === sessionId && session.title === trimmed && previousTitle !== undefined ? { ...session, title: previousTitle } : session) },
        } : old);
        void queryClient.invalidateQueries({ queryKey: summaryKey });
      };
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

        if (paged) pendingTitlesRef.current.set(sessionId, trimmed);
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
          restoreTitle();
          await queryClient.invalidateQueries({
            queryKey: cacheKey,
          });
        }
      } catch (error) {
        if (paged ? requestedCacheIdentity !== cacheIdentityRef.current : requestedIdentity !== identityRef.current) return;
        restoreTitle();
        console.error("Error updating session title:", error);
        await queryClient.invalidateQueries({
          queryKey: cacheKey,
        });
      } finally {
        if (paged && pendingTitlesRef.current.get(sessionId) === trimmed) pendingTitlesRef.current.delete(sessionId);
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
        if (paged) {
          queryClient.setQueryData<ApiResponse<TChatSessionsWireResponse>>(summaryKey, (old) => old ? {
            ...old, data: { ...old.data, sessions: old.data.sessions.filter((session) => session.id !== sessionId) },
          } as ApiResponse<TChatSessionsWireResponse> : old);
          const transcriptKey = ["chat-session-transcripts", currentUser.uid, currentUser.id, HTPR_6924_REST_COMPAT_FLAG, sessionId];
          await queryClient.cancelQueries({ queryKey: transcriptKey });
          queryClient.removeQueries({ queryKey: transcriptKey });
          await queryClient.invalidateQueries({ queryKey: summaryKey });
        }

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

        if (paged) {
          transcriptVersionsRef.current.delete(sessionId);
          pendingMessagesRef.current.delete(sessionId);
          pendingTitlesRef.current.delete(sessionId);
          if (activeSessionRef.current === sessionId) {
            selectionRef.current += 1;
            initializationRef.current = null;
            startingSessionForTaskRef.current = null;
            setActiveSession(null);
            setTranscriptError(false);
          }
        } else if (deletedWasActive) {
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
        if (paged) {
          if (!summaryQuery.isSuccess || (isTaskScoped && taskId === undefined)) return;
          if (activeSession) return;
          const requestedIdentity = identityRef.current;
          const selection = selectionRef.current;
          const initialization = `${requestedIdentity}:${selection}`;
          if (initializationRef.current === initialization) return;
          initializationRef.current = initialization;
          setTranscriptPending(true);
          setTranscriptError(false);
          try {
            const id = taskId === undefined ? summaryQuery.data?.data.sessions[0]?.id : undefined;
            const session = await resolveHistorySession(id, taskId === undefined ? undefined : { taskId });
            if (requestedIdentity !== identityRef.current || selection !== selectionRef.current) return;
            if (session) setActiveSession(session.id);
            else if (taskId !== undefined && startingSessionForTaskRef.current !== taskId) {
              startingSessionForTaskRef.current = taskId;
              const created = await startNewSession(() => requestedIdentity === identityRef.current && selection === selectionRef.current, true);
              if (!created && requestedIdentity === identityRef.current && selection === selectionRef.current) {
                startingSessionForTaskRef.current = null;
                setTranscriptError(true);
              }
            } else setTranscriptError(true);
          } catch {
            if (requestedIdentity === identityRef.current && selection === selectionRef.current) setTranscriptError(true);
          } finally {
            if (requestedIdentity === identityRef.current && selection === selectionRef.current) setTranscriptPending(false);
          }
          return;
        }
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
    startNewSession, paged, summaryQuery.isSuccess, summaryQuery.data, resolveHistorySession, activeSession,
  ]);

  const sessions = isDemo ? demoSessions : sessionsData?.data.sessions || [];
  const summaryBody = summaryQuery.data?.data;
  const historySessions = paged && summaryBody
    ? mergeSessionHistory<Pick<IChatSession, "id" | "title" | "updatedAt" | "createdAt">>(sessions, summaryBody.sessions)
    : sessions;
  const hasMoreSessions = paged && !!summaryBody && isPagedChatSessions(summaryBody) && !!summaryBody.nextCursor;
  // The single source of truth for "the session the user is looking at".
  // Sessions are reordered to the front on select/write, so `sessions[0]` is
  // usually right, but a session can become active (the per-task init effect
  // above) without being reordered yet - resolve by id so every consumer
  // agrees (HTPR-6100). Only fall back to `sessions[0]` when nothing is
  // active at all; if `activeSession` is set but genuinely missing from
  // `sessions` (deleted, or a transient refetch gap), report no session
  // rather than keep showing a possibly-deleted one indefinitely.
  const changingIdentity = paged && previousIdentityRef.current !== identity;
  const currentSession = changingIdentity ? undefined : activeSession
    ? sessions.find((session) => session.id === activeSession)
    : paged ? undefined : sessions[0];
  useEffect(() => {
    if (composeEnabled && composeIntro && isTaskScoped &&
        taskId === composeIntro.taskId && currentSession?.taskId === composeIntro.taskId) {
      const id = `compose-task-${composeIntro.taskId}`;
      if (consumedComposeIntro.current !== id && !currentSession.messages.some((message) => message.id === id)) {
        consumedComposeIntro.current = id;
        // An ordinary stored assistant message, not an AI turn: opening a composed
        // ticket must not spend credits or let the model rewrite it a second time.
        addMessageToSessionQuery(currentSession.id, {
          id, sessionId: currentSession.id, role: "assistant", isDelivered: true,
          createdAt: new Date(), content: composeIntro.content,
        });
      }
      setComposeIntro(null);
    }
  }, [composeEnabled, composeIntro, isTaskScoped, taskId, currentSession, addMessageToSessionQuery, setComposeIntro]);

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
    (changingIdentity || (paged ? (summaryQuery.isLoading || transcriptPending || (!activeSession && summaryQuery.isSuccess && !transcriptError))
      : (isLoadingSessions || (isFetchingSessions && Boolean(activeSession)))));
  const showWelcomeScreen = !transcriptError && !isSessionPending && (currentSession?.messages?.length ?? 0) === 0;

  const isSuccessSessions = paged
    ? summaryQuery.isSuccess && !!currentSession && !transcriptPending && !transcriptError
    : legacySessionsReady;

  return {
    isLoading: isDemo ? false : paged ? summaryQuery.isLoading || transcriptPending : isLoadingSessions,
    isError: isDemo ? false : paged ? summaryQuery.isError || transcriptError : isErrorSessions,
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
    // Background writes may reorder the cache, but send resolvers must follow the displayed session.
    sessions: paged && currentSession ? [currentSession, ...sessions.filter((session) => session.id !== currentSession.id)] : sessions,
    historySessions, hasMoreSessions, isLoadingMoreSessions, pagingError, loadMoreSessions, resolveHistorySession,
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
