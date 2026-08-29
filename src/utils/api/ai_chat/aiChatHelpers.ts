import globalConstants from "@/lib/constants";
import { IChatMessage, IChatSession } from "@/models/model";
import axiosClient, { ApiResponse, isCancel } from "@/utils/axiosClient";
import { AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";

/**
 * Payload structure for sending a message to the AI chat.
 */
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

type TCreateChatSessionNextResponse = {
  success: boolean;
  session: IChatSession;
};

type TUpdateChatSessionResponse = {
  success: boolean;
  session: IChatSession;
};
// Store reference to active message sending requests
const activeMessageRequests = new Map<string, AxiosRequestConfig>();

/**
 * Generate a unique key for a message sending request
 */
const getMessageKey = (sessionId: string) => `message-${sessionId}`;

/**
 * AI Chat API service for handling chat session-related endpoints.
 */
export const AI_Chat_API = {
  addMessage: async (
    sessionId: string,
    message: IChatMessage
  ): Promise<ApiResponse<{ message: IChatMessage }>> => {
    return axiosClient.post<
      { message: IChatMessage },
      { sessionId: string; message: IChatMessage }
    >(globalConstants.addMessageToSessionRoute, { sessionId, message });
  },

  /**
   * Lists all AI chat sessions for the current user (Next.js route, cookie auth).
   */
  getAllSessions: async (): Promise<ApiResponse<TAllChatSessionsResponse>> => {
    return axiosClient.get<TAllChatSessionsResponse>(
      globalConstants.getAllAiChatSessionsRoute
    );
  },

  /**
   * Creates a new AI chat session via the Next.js route (cookie auth).
   */
  createSessionNext: async (taskId?: number): Promise<
    ApiResponse<TCreateChatSessionNextResponse>
  > => {
    return axiosClient.post<
      TCreateChatSessionNextResponse,
      { taskId?: number }
    >(globalConstants.createAiChatSessionNextRoute, {
      ...(taskId ? { taskId } : {}),
    });
  },

  /**
   * Updates a chat session (e.g. title) via the Next.js route (cookie auth).
   */
  updateSession: async (
    sessionId: string,
    title: string
  ): Promise<ApiResponse<TUpdateChatSessionResponse>> => {
    return axiosClient.post<
      TUpdateChatSessionResponse,
      { sessionId: string; title: string }
    >(globalConstants.updateAiChatSessionRoute, { sessionId, title });
  },

  /**
   * Deletes one chat session (`delete` query param = session id). The server
   * ensures at least one session remains per user.
   */
  deleteSession: async (
    sessionId: string
  ): Promise<ApiResponse<{ message: string }>> => {
    return axiosClient.delete<{ message: string }>(
      globalConstants.deleteAiChatSessionRoute,
      { params: { delete: sessionId } }
    );
  },

  /**
   * Sends a message to the AI chat.
   * Stores the config for potential cancellation.
   *
   * @param payload - Message details including session ID, project, and AI model.
   * @param     message: string;
   * @param     session_id: string;
   * @param     projectId: number;
   * @param     teamId: string;
   * @param     model: string;
   * @param     provider: string;
   * @returns A promise resolving to the response from the AI.
   */
  sendMessage: async (payload: TAISendMessage): Promise<ApiResponse<any>> => {
    // First, cancel any existing request for this session
    AI_Chat_API.cancelOngoingMessageRequest(payload.session_id);

    const config: AxiosRequestConfig = {
      // Optional: add additional config settings here if needed
      // timeout: 60000, // longer timeout for AI responses
    };

    // Store the config for future cancellation
    const response = await axiosClient.post<any, TAISendMessage>(
      globalConstants.sendAiChatMessageRoute,
      payload,
      config
    );

    // Store request config for potential cancellation
    const requestKey = getMessageKey(payload.session_id);
    activeMessageRequests.set(requestKey, response.config);

    return response;
  },

  /**
   * Cancels an ongoing message sending request for a specific session
   *
   * @param sessionId - The session ID to cancel the ongoing request for
   * @returns Boolean indicating if a request was found and canceled
   */
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

  /**
   * Cancels all ongoing message requests
   *
   * @returns Number of requests that were canceled
   */
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

  /**
   * Cancels all ongoing requests that match the chat API route pattern
   */
  cancelAllChatRequests: () => {
    return axiosClient.cancelRequestsMatching(/\/chat|\/ai/);
  },
};

// Export a helper function to check if an error is a cancellation error
export const isMessageCanceled = (error: any): boolean => {
  return isCancel(error);
};
