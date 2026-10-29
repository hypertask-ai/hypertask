import type { IChatSession } from "@/models/model";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { ChatSessionScope, TChatSessionsWireResponse } from "@/utils/api/ai_chat";
import type { ApiResponse } from "@/utils/axiosClient";

export type ChatNavigationState = {
  sessionId?: string | null;
  scrollTop?: number;
  scrollAway?: boolean;
  open?: boolean;
};

export function chatNavigationKey(userId: number | undefined, boardId?: number, taskId?: number, fullScreen = false): string | null {
  if (!userId) return null;
  return `aiChat.navigation.${userId}.${fullScreen ? "fullscreen" : "docked"}.${boardId ?? "all"}.${taskId ?? "board"}`;
}

export function readChatNavigationState(key: string | null | undefined): ChatNavigationState {
  if (!key || typeof window === "undefined") return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return {
      sessionId: typeof value.sessionId === "string" ? value.sessionId : null,
      scrollTop: typeof value.scrollTop === "number" && Number.isFinite(value.scrollTop) && value.scrollTop >= 0 ? value.scrollTop : undefined,
      scrollAway: typeof value.scrollAway === "boolean" ? value.scrollAway : undefined,
      open: typeof value.open === "boolean" ? value.open : undefined,
    };
  } catch {
    return {};
  }
}

export function writeChatNavigationState(key: string | null | undefined, state: ChatNavigationState): void {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...readChatNavigationState(key), ...state }));
  } catch {
  }
}

export async function findGeneralNavigationSession(
  queryClient: QueryClient,
  summaryKey: QueryKey,
  getPage: (options: ChatSessionScope & { cursor?: string; limit?: number; emptyOnly?: boolean }, signal?: AbortSignal) => Promise<ApiResponse<TChatSessionsWireResponse>>,
  scope?: ChatSessionScope,
  emptyOnly = false,
  excludeAgent = false,
): Promise<string | undefined> {
  let cursor: string | undefined;
  do {
    const page = await queryClient.fetchQuery({
      queryKey: [...summaryKey, "scope", scope?.taskId ?? null, scope?.projectId ?? null, emptyOnly, cursor ?? null],
      queryFn: ({ signal }) => getPage({ ...scope, ...(emptyOnly ? { emptyOnly: true } : {}), ...(cursor ? { cursor } : {}), limit: excludeAgent && !emptyOnly ? 30 : 1 }, signal),
      staleTime: 0,
    });
    if (!page.data.success) throw new Error("Could not resolve chat session");
    const session = page.data.sessions.find((item) =>
      (!excludeAgent || !item.agentId) && (!scope?.taskId || item.taskId === scope.taskId) && (!scope?.projectId || (item.projectId === scope.projectId && (scope.taskId !== undefined || item.taskId === null))) &&
      (!emptyOnly || (item.taskId === null && ("hasMessages" in item ? !item.hasMessages : item.messages.length === 0))));
    if (session) return session.id;
    cursor = excludeAgent && "nextCursor" in page.data ? page.data.nextCursor ?? undefined : undefined;
  } while (cursor);
}

export function initialChatSessionId(sessions: IChatSession[], selected: string | null, preserveSelection: boolean, navigationKey?: string | null, boardId?: number): string | null {
  const available = navigationKey
    ? sessions.filter((session) => !session.agentId && (boardId === undefined || (session.projectId === boardId && session.taskId === null)))
    : sessions;
  return preserveSelection && available.some((session) => session.id === selected) ? selected : available[0]?.id ?? null;
}
