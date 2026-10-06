import { useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { IChatMessage, IChatSession, IUser } from "@/models/model";
import { AI_Chat_API, isPagedChatSessions, mergeSessionHistory, mergeSessionTranscript, type ChatSessionScope, type ChatSessionSummary, type TPagedChatSessionsResponse } from "@/utils/api/ai_chat";
import { HTPR_6924_REST_COMPAT_FLAG } from "@/lib/flags/keys";

type Transcript = IChatSession & { pendingMessageIds?: string[]; pendingTitle?: string };
type History = InfiniteData<TPagedChatSessionsResponse, string | null>;
const asSummary = (session: IChatSession | ChatSessionSummary): ChatSessionSummary => {
  if ("hasMessages" in session) return session;
  const { id, createdAt, updatedAt, userId, taskId, projectId, title, messages } = session;
  return { id, createdAt, updatedAt, userId, taskId, projectId, title, agentId: null, teamId: null, hasMessages: messages.length > 0 };
};
const staleTime = 1000 * 60 * 3;

export function usePagedChatHistory(enabled: boolean, user: IUser, taskId: number | undefined, historyEnabled: boolean, isTaskScoped: boolean) {
  const queryClient = useQueryClient();
  const summaryKey = ["chat-session-summaries", user?.uid, user?.id, HTPR_6924_REST_COMPAT_FLAG, "history"];
  const transcriptPrefix = ["aiChatTranscript", user?.uid, user?.id, HTPR_6924_REST_COMPAT_FLAG];
  const transcriptKey = (id: string | null) => [...transcriptPrefix, id];
  const identity = `${user?.uid}:${user?.id}:${taskId}:${enabled}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [selection, setSelection] = useState<{ identity: string; id: string | null }>({ identity, id: null });
  const activeSession = selection.identity === identity ? selection.id : null;
  const activeRef = useRef(activeSession);
  activeRef.current = activeSession;
  const [creating, setCreating] = useState(false);
  const [initializationError, setInitializationError] = useState(false);
  const newChatRef = useRef<object | null>(null);
  const taskInitRef = useRef<{ identity: string; promise: Promise<IChatSession | string | undefined> } | null>(null);
  useEffect(() => {
    newChatRef.current = null;
    setCreating(false);
    setInitializationError(false);
  }, [identity]);
  const ready = enabled && historyEnabled && !!user?.uid;
  const setActiveSession = useCallback((id: string | null) => {
    activeRef.current = id;
    setSelection({ identity, id });
  }, [identity]);

  const summaryQuery = useInfiniteQuery({
    queryKey: summaryKey,
    queryFn: async ({ pageParam, signal }) => {
      const response = await AI_Chat_API.getSessionPage(pageParam ? { cursor: pageParam } : {}, signal);
      if (!response.data.success) throw new Error("Could not load chat history");
      return { ...response.data, sessions: response.data.sessions.map(asSummary), nextCursor: isPagedChatSessions(response.data) ? response.data.nextCursor : null };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: ready,
    staleTime,
  });

  const historySessions = enabled ? mergeSessionHistory<Pick<IChatSession, "id" | "title" | "updatedAt" | "createdAt">>(
    summaryQuery.data?.pages.flatMap((page) => page.sessions) ?? [], []
  ) : [];
  const activeSummary = historySessions.find((session) => session.id === activeSession);

  const bumpSummary = (sessionId: string, patch: Partial<ChatSessionSummary>) => {
    // Cancel snapshots before optimistic writes; infinite-query refetch owns all loaded pages.
    void queryClient.cancelQueries({ queryKey: summaryKey });
    const transcript = queryClient.getQueryData<Transcript>(transcriptKey(sessionId));
    queryClient.setQueryData<History>(summaryKey, (old) => {
      if (!old) return old;
      const missing = !old.pages.some((page) => page.sessions.some((session) => session.id === sessionId));
      const updatedAt = new Date();
      return { ...old, pages: old.pages.map((page, index) => ({
        ...page, sessions: [
          ...(missing && !index && transcript ? [{ ...asSummary(transcript), ...patch, updatedAt }] : []),
          ...page.sessions.map((session) => session.id === sessionId ? { ...session, ...patch, updatedAt } : session),
        ],
      })) };
    }, { updatedAt: queryClient.getQueryState(summaryKey)?.dataUpdatedAt });
  };

  const evictSession = async (sessionId: string) => {
    await queryClient.cancelQueries({ queryKey: transcriptKey(sessionId) });
    queryClient.removeQueries({ queryKey: transcriptKey(sessionId) });
    void queryClient.cancelQueries({ queryKey: summaryKey });
    queryClient.setQueryData<History>(summaryKey, (old) => old ? {
      ...old, pages: old.pages.map((page) => ({ ...page, sessions: page.sessions.filter((session) => session.id !== sessionId) })),
    } : old);
    if (identityRef.current === identity && activeRef.current === sessionId) {
      taskInitRef.current = null;
      setActiveSession(null);
    }
    await queryClient.invalidateQueries({ queryKey: summaryKey });
  };

  const transcriptOptions = (sessionId: string | null) => ({
    queryKey: enabled ? transcriptKey(sessionId) : ["chat-sessions", user?.uid],
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Transcript | null> => {
      const key = transcriptKey(sessionId);
      const before = queryClient.getQueryData<Transcript>(key);
      let incoming: IChatSession | null;
      try {
        incoming = await AI_Chat_API.getSessionTranscript(sessionId!, signal);
      } catch (error) {
        if ((error as { response?: { status?: number } }).response?.status !== 404) throw error;
        return null;
      }
      if (!incoming || incoming.userId !== user.id) return null;
      const local = queryClient.getQueryData<Transcript>(key);
      const pendingIds = new Set(local?.pendingMessageIds);
      // Keep writes/acks made after this server snapshot started, even if now acknowledged.
      for (const message of local?.messages ?? []) {
        if (message !== before?.messages.find((row) => row.id === message.id) ||
            (before?.pendingMessageIds?.includes(message.id) && !incoming.messages.some((row) => row.id === message.id))) pendingIds.add(message.id);
      }
      const resolved = mergeSessionTranscript(incoming, local, pendingIds);
      const title = local?.pendingTitle ?? (local?.title !== before?.title ||
        (before?.pendingTitle === local?.title && incoming.title !== local?.title) ? local?.title : undefined);
      return { ...resolved, ...(title === undefined ? {} : { title }), pendingMessageIds: local?.pendingMessageIds, pendingTitle: local?.pendingTitle };
    },
    staleTime,
  });
  const transcriptQuery = useQuery({ ...transcriptOptions(activeSession), enabled: ready && !!activeSession });
  useEffect(() => {
    if (!enabled) return;
    return () => {
      for (const queryKey of [summaryKey, transcriptPrefix]) {
        void queryClient.cancelQueries({ queryKey });
        queryClient.removeQueries({ queryKey });
      }
    };
  }, [enabled, user?.uid, user?.id]);
  const currentSession = activeSession && transcriptQuery.data?.id === activeSession && transcriptQuery.data.userId === user?.id ? transcriptQuery.data : undefined;

  useEffect(() => {
    if (!ready || !activeSession) return;
    // Wait for an older in-flight snapshot before checking the new server version.
    // Optimistic recency writes keep dataUpdatedAt unchanged, so only server refreshes trigger this.
    void (async () => {
      try {
        if (transcriptQuery.isFetching) await queryClient.fetchQuery(transcriptOptions(activeSession));
        if (identityRef.current !== identity || activeRef.current !== activeSession) return;
        const loaded = queryClient.getQueryData<Transcript>(transcriptKey(activeSession));
        if (!loaded || !activeSummary || new Date(activeSummary.updatedAt).getTime() > new Date(loaded.updatedAt).getTime()) {
          const session = await queryClient.fetchQuery({ ...transcriptOptions(activeSession), staleTime: 0 });
          if (session === null) await evictSession(activeSession);
        }
      } catch { /* React Query exposes failures and retries on the next refresh. */ }
    })();
  }, [ready, activeSession, summaryQuery.dataUpdatedAt]);

  useEffect(() => {
    if (ready && activeSession && transcriptQuery.data === null) void evictSession(activeSession);
  }, [ready, activeSession, transcriptQuery.data]);

  const resolveHistorySession = useCallback(async (sessionId?: string, scope?: ChatSessionScope, emptyOnly = false) => {
    let id = sessionId;
    if (!id) {
      const page = await queryClient.fetchQuery({
        queryKey: [...summaryKey, "scope", scope?.taskId ?? null, scope?.projectId ?? null, emptyOnly],
        queryFn: ({ signal }) => AI_Chat_API.getSessionPage({ ...scope, ...(emptyOnly ? { emptyOnly: true } : {}), limit: 1 }, signal),
        staleTime: 0,
      });
      if (!page.data.success) throw new Error("Could not resolve chat session");
      id = page.data.sessions.find((session) =>
        (!scope?.taskId || session.taskId === scope.taskId) && (!scope?.projectId || session.projectId === scope.projectId) &&
        (!emptyOnly || ("hasMessages" in session ? !session.hasMessages : session.messages.length === 0)))?.id;
    }
    if (!id) return;
    const session = await queryClient.fetchQuery(transcriptOptions(id));
    if (session === null) await evictSession(id);
    return session ?? undefined;
  }, [identity, queryClient]);

  const cacheCreatedSession = (session: IChatSession) => {
    const hadHistory = !!queryClient.getQueryData(summaryKey);
    queryClient.setQueryData(transcriptKey(session.id), session);
    void queryClient.cancelQueries({ queryKey: summaryKey });
    const summary = asSummary(session);
    queryClient.setQueryData<History>(summaryKey, (old) => old ? {
      ...old, pages: old.pages.map((page, index) => index ? page : { ...page, sessions: [summary, ...page.sessions.filter((row) => row.id !== session.id)] }),
    } : { pages: [{ success: true, sessions: [summary], nextCursor: null }], pageParams: [null] });
    if (!hadHistory) void queryClient.invalidateQueries({ queryKey: summaryKey });
  };

  const startNewSession = useCallback(async (shouldCommit: () => boolean = () => true) => {
    if (!ready) return;
    const intent = {};
    newChatRef.current = intent;
    setActiveSession(null);
    setCreating(true);
    setInitializationError(false);
    try {
      const response = await AI_Chat_API.createSessionNext(taskId);
      const session = response.data?.session;
      if (!response.data?.success || !session?.id) throw new Error("Could not create chat session");
      if (identityRef.current !== identity || newChatRef.current !== intent || !shouldCommit()) return;
      cacheCreatedSession(session);
      setActiveSession(session.id);
      return session;
    } catch (error) {
      if (identityRef.current === identity && newChatRef.current === intent) setInitializationError(true);
      console.error("Error creating chat session:", error);
    } finally {
      if (identityRef.current === identity && newChatRef.current === intent) {
        newChatRef.current = null;
        setCreating(false);
      }
    }
  }, [identity, ready, queryClient]);

  const selectSession = useCallback(async (sessionId: string) => {
    if (!ready) return;
    newChatRef.current = null;
    setCreating(false);
    setInitializationError(false);
    setActiveSession(sessionId);
    // Explicit reopen revalidates even a fresh cache (another tab may have written).
    try {
      const session = await queryClient.fetchQuery({ ...transcriptOptions(sessionId), staleTime: 0 });
      if (session === null) await evictSession(sessionId);
    } catch { /* Transient errors keep an already loaded transcript usable. */ }
  }, [identity, ready, queryClient]);

  useEffect(() => {
    if (!ready || !summaryQuery.isSuccess || activeSession || newChatRef.current || (isTaskScoped && taskId === undefined)) return;
    let cancelled = false;
    setInitializationError(false);
    const initialize = async () => {
      if (taskId === undefined) {
        setActiveSession(historySessions[0]?.id ?? null);
        return;
      }
      if (taskInitRef.current?.identity !== identity) {
        const promise = (async () => {
          const page = await queryClient.fetchQuery({
            queryKey: [...summaryKey, "task", taskId],
            queryFn: ({ signal }) => AI_Chat_API.getSessionPage({ taskId, limit: 1 }, signal), staleTime: 0,
          });
          if (!page.data.success) throw new Error("Could not resolve task chat");
          const id = page.data.sessions.find((session) => session.taskId === taskId)?.id;
          if (id) return id;
          if (identityRef.current !== identity || activeRef.current || newChatRef.current) return;
          const response = await AI_Chat_API.createSessionNext(taskId);
          if (!response.data.success || !response.data.session?.id) throw new Error("Could not create task chat");
          return response.data.session;
        })();
        taskInitRef.current = { identity, promise };
      }
      const session = await taskInitRef.current.promise;
      if (cancelled || identityRef.current !== identity || activeRef.current || newChatRef.current) return;
      if (session) {
        if (typeof session !== "string") cacheCreatedSession(session);
        setActiveSession(typeof session === "string" ? session : session.id);
      }
    };
    void initialize().catch(() => {
      if (!cancelled && identityRef.current === identity && !activeRef.current) {
        taskInitRef.current = null;
        setInitializationError(true);
      }
    });
    return () => { cancelled = true; };
  }, [ready, identity, activeSession, summaryQuery.isSuccess, summaryQuery.dataUpdatedAt]);

  const addMessageToSessionQuery = useCallback((sessionId: string, message: IChatMessage, queryOnly = false, updateLastMessage = false, projectId?: number) => {
    if (!ready || !queryClient.getQueryData<Transcript>(transcriptKey(sessionId))) return;
    const key = transcriptKey(sessionId);
    queryClient.setQueryData<Transcript>(key, (old) => {
      if (!old) return old;
      const pending = new Set(old.pendingMessageIds);
      let index = old.messages.findIndex((row) => row.id === message.id);
      if (index < 0 && updateLastMessage) {
        // A refresh can append a remote turn after the streaming placeholder.
        for (let i = old.messages.length - 1; i >= 0; i--) {
          if (old.messages[i].role === "assistant" && pending.has(old.messages[i].id)) { index = i; break; }
        }
      }
      const messages = index < 0 ? [...old.messages, message] : old.messages.map((row, i) => i === index ? message : row);
      if (index >= 0 && old.messages[index].id !== message.id) pending.delete(old.messages[index].id);
      if (queryOnly && message.isDelivered === true) pending.delete(message.id);
      else pending.add(message.id);
      return { ...old, messages, projectId: old.projectId ?? projectId, pendingMessageIds: [...pending] };
    });
    bumpSummary(sessionId, { hasMessages: true, ...(projectId ? { projectId } : {}) });
    if (!queryOnly) void AI_Chat_API.addMessage(sessionId, message).then((response) => {
      const saved = response.data?.message;
      if (!saved) return;
      queryClient.setQueryData<Transcript>(key, (old) => {
        if (!old || old.messages.find((row) => row.id === message.id) !== message) return old;
        return { ...old, messages: old.messages.map((row) => row.id === message.id ? saved : row), pendingMessageIds: old.pendingMessageIds?.filter((id) => id !== message.id) };
      });
      void queryClient.invalidateQueries({ queryKey: summaryKey });
    }).catch((error) => {
      if (error?.response?.status === 404) void evictSession(sessionId);
      console.error("Error persisting chat message:", error);
    });
  }, [identity, ready, queryClient]);

  const updateSessionTitle = useCallback(async (sessionId: string, title: string) => {
    const trimmed = title.trim();
    if (!ready || !trimmed) return;
    const key = transcriptKey(sessionId);
    const previous = queryClient.getQueryData<Transcript>(key)?.title;
    queryClient.setQueryData<Transcript>(key, (old) => old ? { ...old, title: trimmed, pendingTitle: trimmed } : old);
    bumpSummary(sessionId, { title: trimmed });
    try {
      const response = await AI_Chat_API.updateSession(sessionId, trimmed);
      if (!response.data.success) throw new Error("Could not rename chat session");
    } catch (error) {
      if ((error as { response?: { status?: number } }).response?.status === 404) await evictSession(sessionId);
      queryClient.setQueryData<Transcript>(key, (old) => old?.pendingTitle === trimmed && previous !== undefined ? { ...old, title: previous } : old);
      console.error("Error updating session title:", error);
    } finally {
      queryClient.setQueryData<Transcript>(key, (old) => old?.pendingTitle === trimmed ? { ...old, pendingTitle: undefined } : old);
      await queryClient.invalidateQueries({ queryKey: summaryKey });
    }
  }, [identity, ready, queryClient]);

  const deleteSession = useCallback(async (sessionId: string) => {
    if (!ready) return;
    try {
      await AI_Chat_API.deleteSession(sessionId);
      await evictSession(sessionId);
    } catch (error) {
      if ((error as { response?: { status?: number } }).response?.status === 404) await evictSession(sessionId);
      console.error("Error deleting chat session:", error);
    }
  }, [identity, ready, queryClient]);

  const getDisplayedSession = useCallback(() => {
    if (!ready || identityRef.current !== identity || newChatRef.current || !activeRef.current) return;
    const session = queryClient.getQueryData<Transcript>(transcriptKey(activeRef.current));
    return session?.id === activeRef.current && session.userId === user.id ? session : undefined;
  }, [identity, ready, queryClient]);

  const isSessionPending = ready && !currentSession && !initializationError && (summaryQuery.isLoading || transcriptQuery.isFetching || creating || (!activeSession && summaryQuery.isSuccess));
  return {
    activeSession, currentSession, setActiveSession, startNewSession, selectSession, addMessageToSessionQuery, updateSessionTitle, deleteSession,
    updateLastMessageInSessionCache: (id: string, message: IChatMessage) => addMessageToSessionQuery(id, message, true, true),
    appendMessageToSessionCache: (id: string, message: IChatMessage) => addMessageToSessionQuery(id, message, true),
    getDisplayedSession,
    sessions: currentSession ? [currentSession] : [], historySessions,
    hasMoreSessions: summaryQuery.hasNextPage, isLoadingMoreSessions: summaryQuery.isFetchingNextPage, pagingError: summaryQuery.isFetchNextPageError,
    loadMoreSessions: async () => { if (summaryQuery.hasNextPage && !summaryQuery.isFetching) await summaryQuery.fetchNextPage(); }, resolveHistorySession,
    isLoading: isSessionPending, isSessionPending,
    isError: initializationError || summaryQuery.isError || (!currentSession && transcriptQuery.isError),
    isSuccess: ready && !!currentSession && !creating,
    showWelcomeScreen: !isSessionPending && !initializationError && !transcriptQuery.isError && (currentSession?.messages.length ?? 0) === 0,
    mounted: !!currentSession, hasRequiredData: !!user?.uid,
  };
}
