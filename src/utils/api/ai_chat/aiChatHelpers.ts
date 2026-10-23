import { sidebarChatHeaders } from "@/lib/agents/chatViewerState";
import globalConstants from "@/lib/constants";
import { IChatMessage, IChatSession } from "@/models/model";
import axiosClient, { ApiResponse, isCancel } from "@/utils/axiosClient";
import { AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";

type TAISendMessage = {
  message: string;
  session_id: string;
  projectId: number;
  teamId: string;
  model: string;
  provider: string;
};

export type TAllChatSessionsResponse = {
  success: boolean;
  sessions: IChatSession[];
};

export type ChatSessionSummary = Pick<IChatSession,
  "id" | "createdAt" | "updatedAt" | "userId" | "taskId" | "projectId" | "title"
> & { agentId: string | null; teamId: string | null; hasMessages: boolean };
export type TPagedChatSessionsResponse = {
  success: boolean;
  sessions: ChatSessionSummary[];
  nextCursor: string | null;
};
export type TChatSessionsWireResponse = TAllChatSessionsResponse | TPagedChatSessionsResponse;
export type ChatSessionScope = { taskId?: number; projectId?: number };
export const isPagedChatSessions = (body: TChatSessionsWireResponse): body is TPagedChatSessionsResponse =>
  "nextCursor" in body;

export function mergeSessionHistory<T extends { id: string; updatedAt: Date }>(newer: T[], older: T[]): T[] {
  const byId = new Map(older.map((session) => [session.id, session]));
  for (const session of newer) {
    const previous = byId.get(session.id);
    if (!previous || new Date(session.updatedAt).getTime() >= new Date(previous.updatedAt).getTime()) {
      byId.set(session.id, session);
    }
  }
  return [...byId.values()].sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() || b.id.localeCompare(a.id)
  );
}

export function mergeSessionTranscript(incoming: IChatSession, local?: IChatSession, pendingMessageIds: ReadonlySet<string> = new Set()): IChatSession {
  if (!local) return incoming;
  const messages = new Map(incoming.messages.map((message) => [message.id, message]));
  for (const message of local.messages) {
    if (pendingMessageIds.has(message.id)) messages.set(message.id, message);
  }
  const localOrder = new Map(local.messages.map((message, index) => [message.id, index]));
  return { ...incoming, messages: [...messages.values()].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
    (localOrder.has(a.id) && localOrder.has(b.id) ? localOrder.get(a.id)! - localOrder.get(b.id)! : 0)
  ) };
}

type TCreateChatSessionNextResponse = {
  success: boolean;
  session: IChatSession;
};

type TUpdateChatSessionResponse = {
  success: boolean;
  session: IChatSession;
};
const activeMessageRequests = new Map<string, AxiosRequestConfig>();

const getMessageKey = (sessionId: string) => `message-${sessionId}`;

export const AI_Chat_API = {
  addMessage: async (
    sessionId: string,
    message: IChatMessage
  ): Promise<ApiResponse<{ message: IChatMessage }>> => {
    return axiosClient.post<
      { message: IChatMessage },
      { sessionId: string; message: IChatMessage }
    >(globalConstants.addMessageToSessionRoute, { sessionId, message }, { headers: sidebarChatHeaders(sessionId) });
  },

  getAllSessions: async (): Promise<ApiResponse<TAllChatSessionsResponse>> => {
    return axiosClient.get<TAllChatSessionsResponse>(
      globalConstants.getAllAiChatSessionsRoute
    );
  },

  getSessionPage: async (options: ChatSessionScope & { cursor?: string; limit?: number; emptyOnly?: boolean } = {}, signal?: AbortSignal): Promise<ApiResponse<TChatSessionsWireResponse>> =>
    axiosClient.get<TChatSessionsWireResponse>(globalConstants.getAllAiChatSessionsRoute, {
      params: { compat: "htpr-6924", limit: 30, ...options }, signal,
    }),

  getSessionTranscript: async (sessionId: string, signal?: AbortSignal, sidebarProjectId?: number): Promise<IChatSession | null> => {
    const response = await axiosClient.get<{ success: boolean; session: IChatSession } | TAllChatSessionsResponse>(
      globalConstants.getAllAiChatSessionsRoute,
      { params: { compat: "htpr-6924", sessionId }, signal, headers: sidebarProjectId ? { "x-hypertask-sidebar-project": String(sidebarProjectId) } : sidebarChatHeaders(sessionId) }
    );
    if ("session" in response.data) return response.data.session;
    const legacy = await AI_Chat_API.getAllSessions();
    return legacy.data.sessions.find((session) => session.id === sessionId) ?? null;
  },

  createSessionNext: async (taskId?: number, projectId?: number): Promise<
    ApiResponse<TCreateChatSessionNextResponse>
  > => {
    return axiosClient.post<
      TCreateChatSessionNextResponse,
      { taskId?: number; projectId?: number }
    >(globalConstants.createAiChatSessionNextRoute, {
      ...(taskId ? { taskId } : {}),
      ...(projectId ? { projectId } : {}),
    });
  },

  updateSession: async (
    sessionId: string,
    title: string
  ): Promise<ApiResponse<TUpdateChatSessionResponse>> => {
    return axiosClient.post<
      TUpdateChatSessionResponse,
      { sessionId: string; title: string }
    >(globalConstants.updateAiChatSessionRoute, { sessionId, title });
  },

  deleteSession: async (
    sessionId: string
  ): Promise<ApiResponse<{ message: string }>> => {
    return axiosClient.delete<{ message: string }>(
      globalConstants.deleteAiChatSessionRoute,
      { params: { delete: sessionId } }
    );
  },

  sendMessage: async (payload: TAISendMessage): Promise<ApiResponse<any>> => {
    AI_Chat_API.cancelOngoingMessageRequest(payload.session_id);

    const config: AxiosRequestConfig = {
    };

    const response = await axiosClient.post<any, TAISendMessage>(
      globalConstants.sendAiChatMessageRoute,
      payload,
      config
    );

    const requestKey = getMessageKey(payload.session_id);
    activeMessageRequests.set(requestKey, response.config);

    return response;
  },

  cancelOngoingMessageRequest: (sessionId: string): boolean => {
    const requestKey = getMessageKey(sessionId);
    const config = activeMessageRequests.get(requestKey);

    if (config) {
      const canceled = axiosClient.cancelRequest(
        config as InternalAxiosRequestConfig
      );
      if (canceled) {
        activeMessageRequests.delete(requestKey);
      }
      return canceled;
    }

    return false;
  },

  cancelAllMessageRequests: (): number => {
    let cancelCount = 0;

    activeMessageRequests.forEach((config, key) => {
      const canceled = axiosClient.cancelRequest(
        config as InternalAxiosRequestConfig
      );
      if (canceled) {
        cancelCount++;
      }
    });

    activeMessageRequests.clear();
    return cancelCount;
  },

  cancelAllChatRequests: () => {
    return axiosClient.cancelRequestsMatching(/\/chat|\/ai/);
  },
};

export const isMessageCanceled = (error: any): boolean => {
  return isCancel(error);
};
